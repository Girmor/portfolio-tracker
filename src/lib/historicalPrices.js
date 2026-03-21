import { getCoinId } from './priceService'
import { supabase } from './supabase'

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
 * Batch-fetch historical prices via get-stock-history Edge Function (stooq.com).
 * Returns Map of ticker → Map<'YYYY-MM-DD', number>.
 */
async function fetchHistoryBatch(symbols) {
  const { data, error } = await supabase.functions.invoke('get-stock-history', {
    body: { symbols },
  })
  if (error || !data?.prices) return {}

  const result = {}
  for (const [ticker, prices] of Object.entries(data.prices)) {
    const map = new Map()
    for (const [day, price] of Object.entries(prices)) {
      map.set(day, price)
    }
    if (map.size > 0) result[ticker] = map
  }
  return result
}

// Tracks whether a batch fetch is in-flight to avoid duplicate calls
let _batchPromise = null
let _batchSymbols = []

/**
 * Queue a ticker for batch fetch via Edge Function.
 * Groups all concurrent fetchStockHistory calls into a single batch request.
 */
function queueBatchFetch(ticker) {
  _batchSymbols.push(ticker)
  if (!_batchPromise) {
    _batchPromise = new Promise(resolve => {
      // Wait a microtask to collect all concurrent calls
      queueMicrotask(async () => {
        const symbols = [...new Set(_batchSymbols)]
        _batchSymbols = []
        _batchPromise = null
        try {
          resolve(await fetchHistoryBatch(symbols))
        } catch {
          resolve({})
        }
      })
    })
  }
  return _batchPromise
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
  const cacheKey = `ph_stock_${ticker}`

  // Cache-first: historical daily prices are immutable, no need to re-fetch
  const cached = cacheGet(cacheKey)
  if (cached?.size > 0) return cached

  // Try Edge Function (stooq.com, no rate limits)
  try {
    const batch = await queueBatchFetch(ticker)
    if (batch[ticker]?.size > 0) {
      cacheSet(cacheKey, batch[ticker])
      return batch[ticker]
    }
  } catch { /* fall through to Alpha Vantage */ }

  // Fallback: Alpha Vantage (25 req/day per key)
  const keys = [
    import.meta.env.VITE_ALPHAVANTAGE_KEY,
    import.meta.env.VITE_ALPHAVANTAGE_KEY2,
  ].filter(Boolean)

  for (const key of keys) {
    try {
      const res = await fetch(
        `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY` +
        `&symbol=${encodeURIComponent(ticker)}&outputsize=full&apikey=${key}`
      )
      if (!res.ok) continue
      const json = await res.json()
      const series = json['Time Series (Daily)']
      if (!series) continue

      const from = fromDate ? fromDate.split('T')[0] : null
      const map = new Map()
      for (const [day, vals] of Object.entries(series)) {
        if (from && day < from) continue
        const price = parseFloat(vals['4. close'])
        if (!isNaN(price)) map.set(day, price)
      }
      if (map.size > 0) {
        cacheSet(cacheKey, map)
        return map
      }
    } catch { /* try next key */ }
  }

  return new Map()
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
