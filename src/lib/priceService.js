import { supabase } from './supabase'

/**
 * Fetch prices via the sync-prices Edge Function (server-side, Finnhub key stays secret).
 * Falls back to direct API calls if the Edge Function is unavailable.
 *
 * @param {Array<{ticker: string, type: 'stock'|'crypto', coin_id?: string}>} positions
 * @returns {Promise<Record<string, number|null>>} map of ticker → price
 */
export async function getPricesFromServer(positions) {
  if (!positions || positions.length === 0) return {}

  const symbols = positions.map(p => ({
    symbol: p.ticker,
    type: p.type,
    coinGeckoId: p.type === 'crypto' ? (p.coin_id || p.ticker.toLowerCase()) : undefined,
  }))

  try {
    const { data, error } = await supabase.functions.invoke('sync-prices', {
      body: { symbols },
    })

    if (error) throw error

    // data.prices is keyed by ticker symbol
    const result = {}
    for (const p of positions) {
      result[p.ticker] = data?.prices?.[p.ticker] ?? null
    }
    return result
  } catch (err) {
    console.warn('[priceService] sync-prices Edge Function failed, falling back to direct API:', err)
    // Fallback: use legacy direct calls
    const cryptoPositions = positions.filter(p => p.type === 'crypto')
    const stockPositions = positions.filter(p => p.type === 'stock')

    const [cryptoPrices, stockPrices] = await Promise.all([
      cryptoPositions.length
        ? getCryptoPrices(cryptoPositions.map(p => getCoinId(p)))
        : {},
      stockPositions.length
        ? getStockPrices(stockPositions.map(p => p.ticker))
        : {},
    ])

    const result = {}
    for (const p of positions) {
      if (p.type === 'crypto') result[p.ticker] = cryptoPrices[getCoinId(p)] ?? null
      else result[p.ticker] = stockPrices[p.ticker] ?? null
    }
    return result
  }
}

export async function getCryptoPrice(coinId) {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coinId)}&vs_currencies=usd`
    )
    if (!res.ok) return null
    const data = await res.json()
    return data[coinId]?.usd ?? null
  } catch {
    return null
  }
}

export async function getCryptoPrices(coinIds, retries = 2) {
  if (!coinIds.length) return {}
  try {
    const ids = coinIds.map(id => encodeURIComponent(id)).join(',')
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`
    )
    if (!res.ok) {
      if (retries > 0 && (res.status === 429 || res.status >= 500)) {
        await new Promise(r => setTimeout(r, 3000))
        return getCryptoPrices(coinIds, retries - 1)
      }
      return {}
    }
    const data = await res.json()
    const result = {}
    for (const id of coinIds) {
      result[id] = data[id]?.usd ?? null
    }
    return result
  } catch {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 3000))
      return getCryptoPrices(coinIds, retries - 1)
    }
    return {}
  }
}

export async function getStockPrice(ticker) {
  const key = import.meta.env.VITE_FINNHUB_KEY
  if (!key) return null
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${key}`
    )
    if (!res.ok) return null
    const data = await res.json()
    return data.c || null
  } catch {
    return null
  }
}

export async function getStockPrices(tickers) {
  const results = {}
  await Promise.all(
    tickers.map(async (ticker) => {
      results[ticker] = await getStockPrice(ticker)
    })
  )
  return results
}

const CRYPTO_MAP = {
  btc: 'bitcoin',
  eth: 'ethereum',
  sol: 'solana',
  ada: 'cardano',
  dot: 'polkadot',
  matic: 'matic-network',
  avax: 'avalanche-2',
  link: 'chainlink',
  uni: 'uniswap',
  atom: 'cosmos',
  xrp: 'ripple',
  doge: 'dogecoin',
  shib: 'shiba-inu',
  ltc: 'litecoin',
  bnb: 'binancecoin',
}

export function tickerToCoinId(ticker) {
  const lower = ticker.toLowerCase()
  return CRYPTO_MAP[lower] || lower
}

export function getCoinId(pos) {
  return pos.coin_id || tickerToCoinId(pos.ticker)
}

export async function resolveMissingCoinIds(positions, supabase) {
  const needsResolution = positions.filter(p => p.type === 'crypto' && !p.coin_id)
  if (needsResolution.length === 0) return positions

  const resolved = new Map()
  const uniqueTickers = [...new Set(needsResolution.map(p => p.ticker.toUpperCase()))]

  for (let i = 0; i < uniqueTickers.length; i++) {
    const ticker = uniqueTickers[i]
    try {
      const results = await searchCrypto(ticker)
      const match = results.find(r => r.ticker.toUpperCase() === ticker)
      if (match?.coinId) {
        resolved.set(ticker, match.coinId)
      }
    } catch { /* skip, will retry on next load */ }

    if (i < uniqueTickers.length - 1) {
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  if (resolved.size === 0) return positions

  const updatePromises = []
  const updatedPositions = positions.map(pos => {
    const coinId = resolved.get(pos.ticker.toUpperCase())
    if (pos.type === 'crypto' && !pos.coin_id && coinId) {
      updatePromises.push(
        supabase.from('positions').update({ coin_id: coinId }).eq('id', pos.id)
      )
      return { ...pos, coin_id: coinId }
    }
    return pos
  })

  await Promise.all(updatePromises)
  return updatedPositions
}

function compCacheGet(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function compCacheSet(key, entries) {
  try { localStorage.setItem(key, JSON.stringify(entries)) } catch {}
}

export async function getBtcHistoricalPrices() {
  const cacheKey = 'ph_btc_comparison'

  // Reuse asset cache if BTC is already in the portfolio (populated by fetchCryptoHistory).
  // Format: { entries: [['YYYY-MM-DD', price], ...] }
  try {
    const raw = localStorage.getItem('ph_crypto_bitcoin')
    if (raw) {
      const { entries } = JSON.parse(raw)
      if (Array.isArray(entries) && entries.length > 0) {
        return entries.map(([day, price]) => ({
          date: new Date(day + 'T00:00:00Z').getTime(),
          price,
        }))
      }
    }
  } catch {}

  // Primary: CryptoCompare — no API key needed, much higher rate limits than CoinGecko.
  try {
    const res = await fetch(
      'https://min-api.cryptocompare.com/data/v2/histoday?fsym=BTC&tsym=USD&limit=2000&aggregate=1'
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    if (json.Response !== 'Success') throw new Error('no data')
    const prices = (json.Data?.Data || [])
      .filter(d => d.close > 0)
      .map(d => ({ date: d.time * 1000, price: d.close }))
    if (prices.length > 0) compCacheSet(cacheKey, prices)
    return prices
  } catch {}

  // Fallback: stale cache or CoinGecko
  const cached = compCacheGet(cacheKey)
  if (cached?.length) return cached

  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=max'
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const prices = (data.prices || []).map(([ts, price]) => ({ date: ts, price }))
    if (prices.length > 0) compCacheSet(cacheKey, prices)
    return prices
  } catch {
    return []
  }
}

export async function getSpxHistoricalPrices() {
  const cacheKey = 'ph_spx_comparison'
  const finnhubKey = import.meta.env.VITE_FINNHUB_KEY

  // Primary: Finnhub (5-year window)
  if (finnhubKey) {
    const from = Math.floor(Date.now() / 1000) - 5 * 365 * 24 * 60 * 60
    const to = Math.floor(Date.now() / 1000)
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/stock/candle?symbol=SPY&resolution=D&from=${from}&to=${to}&token=${finnhubKey}`
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.s !== 'ok' || !data.t?.length) throw new Error('no data')
      const prices = data.t.map((ts, i) => ({ date: ts * 1000, price: data.c[i] }))
      if (prices.length > 0) { compCacheSet(cacheKey, prices); return prices }
    } catch {}
  }

  // Fallback: stale localStorage cache
  const cached = compCacheGet(cacheKey)
  if (cached?.length) return cached

  // Last resort: stooq.com — free, no key, CORS-friendly
  try {
    const res = await fetch('https://stooq.com/q/d/l/?s=spy.us&i=d')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    const lines = text.trim().split('\n').slice(1) // skip header row
    const prices = lines
      .map(line => {
        const cols = line.split(',')
        const date = cols[0]
        const close = parseFloat(cols[4])
        if (!date || !isFinite(close)) return null
        return { date: new Date(date + 'T00:00:00Z').getTime(), price: close }
      })
      .filter(Boolean)
      .sort((a, b) => a.date - b.date)
    if (prices.length > 0) { compCacheSet(cacheKey, prices); return prices }
  } catch {}

  return []
}

/**
 * Fetch dividend history for a stock ticker from Alpha Vantage.
 * Returns { freq, history: [{date, amount}] } or null on failure.
 * freq: 1=annual, 2=semiannual, 4=quarterly, 12=monthly (derived from date gaps)
 */
export async function fetchDividendHistory(ticker) {
  const key = import.meta.env.VITE_ALPHAVANTAGE_KEY
  if (!key) return null

  // Session cache to avoid hitting rate limits on repeated renders
  const cacheKey = `div_meta_${ticker}`
  try {
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) return JSON.parse(cached)
  } catch {}

  try {
    const res = await fetch(
      `https://www.alphavantage.co/query?function=DIVIDENDS&symbol=${encodeURIComponent(ticker)}&apikey=${key}`
    )
    if (!res.ok) return null
    const json = await res.json()
    const records = json?.data
    if (!Array.isArray(records) || records.length === 0) return null

    // AV returns newest-first; sort ascending by date
    const sorted = [...records]
      .filter(r => r.ex_dividend_date && r.ex_dividend_date !== 'None')
      .sort((a, b) => new Date(a.ex_dividend_date) - new Date(b.ex_dividend_date))

    if (sorted.length === 0) return null

    // Derive frequency from median gap between consecutive payments
    let freq = null
    if (sorted.length >= 2) {
      const gaps = []
      for (let i = 1; i < sorted.length; i++) {
        const diff = (new Date(sorted[i].ex_dividend_date) - new Date(sorted[i - 1].ex_dividend_date)) / (1000 * 60 * 60 * 24)
        gaps.push(diff)
      }
      gaps.sort((a, b) => a - b)
      const median = gaps[Math.floor(gaps.length / 2)]
      if (median < 45)       freq = 12  // monthly
      else if (median < 120) freq = 4   // quarterly
      else if (median < 240) freq = 2   // semiannual
      else                   freq = 1   // annual
    }

    const history = sorted.map(r => ({ date: r.ex_dividend_date, amount: Number(r.amount) }))
    const result = { freq, history }

    try { sessionStorage.setItem(cacheKey, JSON.stringify(result)) } catch {}
    return result
  } catch {
    return null
  }
}

export async function searchStocks(query) {
  const key = import.meta.env.VITE_FINNHUB_KEY
  if (!key || !query || query.length < 1) return []
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${key}`
    )
    if (!res.ok) return []
    const data = await res.json()
    return (data.result || []).slice(0, 10).map(item => ({
      ticker: item.symbol,
      name: item.description,
      type: item.type || 'Stock',
    }))
  } catch {
    return []
  }
}

export async function searchCrypto(query) {
  if (!query || query.length < 1) return []
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`
    )
    if (!res.ok) return []
    const data = await res.json()
    return (data.coins || []).slice(0, 10).map(coin => ({
      ticker: coin.symbol.toUpperCase(),
      name: coin.name,
      coinId: coin.id,
    }))
  } catch {
    return []
  }
}
