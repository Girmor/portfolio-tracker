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

export async function getCryptoPrices(coinIds) {
  if (!coinIds.length) return {}
  try {
    const ids = coinIds.map(id => encodeURIComponent(id)).join(',')
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`
    )
    if (!res.ok) return {}
    const data = await res.json()
    const result = {}
    for (const id of coinIds) {
      result[id] = data[id]?.usd ?? null
    }
    return result
  } catch {
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
