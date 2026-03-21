import { corsResponse, jsonResponse, errorResponse } from '../_shared/cors.ts'

/**
 * Edge Function: get-stock-history
 *
 * Fetches historical daily close prices from stooq.com (free, no API key).
 * Runs server-side to avoid CORS. Client caches results in localStorage.
 *
 * POST body: { symbols: ['SPY', 'JEPI', ...] }
 * Response:  { prices: { SPY: { '2024-01-02': 123.45, ... }, ... } }
 */

async function fetchStooqHistory(symbol: string): Promise<Record<string, number>> {
  const res = await fetch(
    `https://stooq.com/q/d/l/?s=${symbol.toLowerCase()}.us&i=d`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } },
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const csv = await res.text()
  const lines = csv.trim().split('\n')
  if (lines.length < 2) throw new Error('empty CSV')

  // Header: Date,Open,High,Low,Close,Volume
  const prices: Record<string, number> = {}
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',')
    if (parts.length >= 5) {
      const date = parts[0] // YYYY-MM-DD
      const close = parseFloat(parts[4])
      if (date && !isNaN(close)) prices[date] = close
    }
  }
  return prices
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse()

  try {
    const { symbols } = await req.json()
    if (!Array.isArray(symbols) || symbols.length === 0) {
      return errorResponse('symbols array required')
    }

    // Limit to 10 symbols per request
    const toFetch = symbols.slice(0, 10) as string[]
    const result: Record<string, Record<string, number>> = {}

    // Fetch sequentially to be polite to stooq
    for (const symbol of toFetch) {
      try {
        result[symbol] = await fetchStooqHistory(symbol)
      } catch {
        // Skip failed symbols
      }
    }

    return jsonResponse({ prices: result })
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'unknown error', 500)
  }
})
