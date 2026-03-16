import { getCoinId } from './priceService'

/**
 * Fetches historical daily prices for a crypto position from CoinGecko.
 * Returns Map<'YYYY-MM-DD', number>
 */
export async function fetchCryptoHistory(position, days) {
  const coinId = getCoinId(position)
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinId)}/market_chart` +
      `?vs_currency=usd&days=${days}`
    )
    if (!res.ok) return new Map()
    const { prices } = await res.json()
    const map = new Map()
    for (const [ts, price] of (prices || [])) {
      const day = new Date(ts).toISOString().split('T')[0]
      map.set(day, price)
    }
    return map
  } catch {
    return new Map()
  }
}

/**
 * Fetches historical daily close prices for a stock from Finnhub.
 * Returns Map<'YYYY-MM-DD', number>
 */
export async function fetchStockHistory(ticker, fromDate, toDate) {
  const key = import.meta.env.VITE_FINNHUB_KEY
  if (!key) return new Map()
  const from = Math.floor(new Date(fromDate).getTime() / 1000)
  const to = Math.floor(new Date(toDate).getTime() / 1000)
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/candle` +
      `?symbol=${encodeURIComponent(ticker)}&resolution=D&from=${from}&to=${to}&token=${key}`
    )
    if (!res.ok) return new Map()
    const data = await res.json()
    if (data.s !== 'ok' || !data.t?.length) return new Map()
    const map = new Map()
    for (let i = 0; i < data.t.length; i++) {
      const day = new Date(data.t[i] * 1000).toISOString().split('T')[0]
      map.set(day, data.c[i])
    }
    return map
  } catch {
    return new Map()
  }
}

/**
 * Fills gaps in a price map by carrying the last known price forward.
 * Returns a new Map<day, price|null> where null means no price known yet.
 */
export function fillForward(priceMap, days) {
  const result = new Map()
  let last = null
  for (const day of days) {
    if (priceMap.has(day)) last = priceMap.get(day)
    result.set(day, last)
  }
  return result
}

/**
 * Generates an array of 'YYYY-MM-DD' strings from startDateStr to today (inclusive).
 */
export function buildDayRange(startDateStr) {
  const days = []
  const start = new Date(startDateStr + 'T00:00:00Z')
  const end = new Date()
  end.setUTCHours(0, 0, 0, 0)
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().split('T')[0])
  }
  return days
}
