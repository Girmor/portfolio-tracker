import { getCoinId } from './priceService'

/**
 * Fetches historical daily prices for a crypto position from CoinGecko.
 * Returns Map<'YYYY-MM-DD', number>
 */
export async function fetchCryptoHistory(position, days) {
  const coinId = getCoinId(position)
  // CoinGecko free tier returns errors for very large day counts on some endpoints.
  // Use 'max' for anything over a year to get all available daily data.
  const daysParam = days > 365 ? 'max' : days
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinId)}/market_chart` +
      `?vs_currency=usd&days=${daysParam}`
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
 * Fetches historical daily close prices for a stock from Yahoo Finance.
 * Returns Map<'YYYY-MM-DD', number>
 */
export async function fetchStockHistory(ticker, fromDate) {
  const daysAgo = Math.ceil((Date.now() - new Date(fromDate)) / (1000 * 60 * 60 * 24))
  const range = daysAgo > 1825 ? '10y' : daysAgo > 730 ? '5y' : daysAgo > 365 ? '2y' : '1y'

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
      `?interval=1d&range=${range}`
    )
    if (!res.ok) return new Map()
    const json = await res.json()
    const result = json?.chart?.result?.[0]
    if (!result) return new Map()

    const timestamps = result.timestamp || []
    const closes = result.indicators?.quote?.[0]?.close || []
    const map = new Map()
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] == null) continue
      const day = new Date(timestamps[i] * 1000).toISOString().split('T')[0]
      map.set(day, closes[i])
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
