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
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=max`
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const prices = (data.prices || []).map(([timestamp, price]) => ({ date: timestamp, price }))
    if (prices.length > 0) compCacheSet(cacheKey, prices)
    return prices
  } catch {
    return compCacheGet(cacheKey) ?? []
  }
}

export async function getSpxHistoricalPrices() {
  const cacheKey = 'ph_spx_comparison'
  const key = import.meta.env.VITE_FINNHUB_KEY
  if (!key) return compCacheGet(cacheKey) ?? []
  const from = Math.floor(new Date('2010-01-01').getTime() / 1000)
  const to = Math.floor(Date.now() / 1000)
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/candle?symbol=SPY&resolution=D&from=${from}&to=${to}&token=${key}`
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    if (data.s !== 'ok') throw new Error('no data')
    const prices = data.t.map((ts, i) => ({ date: ts * 1000, price: data.c[i] }))
    if (prices.length > 0) compCacheSet(cacheKey, prices)
    return prices
  } catch {
    return compCacheGet(cacheKey) ?? []
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
