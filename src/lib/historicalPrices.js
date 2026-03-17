import { getCoinId } from './priceService'

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const { entries } = JSON.parse(raw)
    return new Map(entries)
  } catch { return null }
}

function cacheSet(key, map) {
  try {
    localStorage.setItem(key, JSON.stringify({ entries: [...map] }))
  } catch {}
}

/**
 * Fetches historical daily prices for a crypto position from CoinGecko.
 * On success — updates cache. On failure — returns cached data if available.
 * Returns Map<'YYYY-MM-DD', number>
 */
export async function fetchCryptoHistory(position, _days) {
  const coinId = getCoinId(position)
  const cacheKey = `ph_crypto_${coinId}`
  // Always request 'max' — CoinGecko caches this response globally,
  // which avoids per-user rate limiting that hits unique day counts.
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinId)}/market_chart` +
      `?vs_currency=usd&days=max`
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const { prices } = await res.json()
    const map = new Map()
    for (const [ts, price] of (prices || [])) {
      const day = new Date(ts).toISOString().split('T')[0]
      map.set(day, price)
    }
    if (map.size > 0) cacheSet(cacheKey, map)
    return map
  } catch {
    return cacheGet(cacheKey) ?? new Map()
  }
}

/**
 * Fetches historical daily adjusted close prices for a stock from Alpha Vantage.
 * On success — updates cache. On failure — returns cached data if available.
 * Returns Map<'YYYY-MM-DD', number>
 */
export async function fetchStockHistory(ticker, fromDate) {
  const key = import.meta.env.VITE_ALPHAVANTAGE_KEY
  if (!key) return new Map()

  const cacheKey = `ph_stock_${ticker}`
  try {
    const res = await fetch(
      `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY` +
      `&symbol=${encodeURIComponent(ticker)}&outputsize=full&apikey=${key}`
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    const series = json['Time Series (Daily)']
    if (!series) throw new Error('no series')

    const from = fromDate ? fromDate.split('T')[0] : null
    const map = new Map()
    for (const [day, vals] of Object.entries(series)) {
      if (from && day < from) continue
      const price = parseFloat(vals['4. close'])
      if (!isNaN(price)) map.set(day, price)
    }
    if (map.size > 0) cacheSet(cacheKey, map)
    return map
  } catch {
    return cacheGet(cacheKey) ?? new Map()
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
