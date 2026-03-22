import { corsResponse, jsonResponse, errorResponse } from '../_shared/cors.ts'

/**
 * Edge Function: get-stock-overview
 *
 * Fetches P/E ratio from Yahoo Finance (works for stocks AND ETFs).
 * Runs server-side to avoid CORS and rate limits.
 *
 * POST body: { symbols: ['WMT', 'JEPI', ...] }
 * Response:  { data: { WMT: { pe: 36.5 }, JEPI: { pe: 12.1 }, ... } }
 */

async function fetchYahooQuote(symbol: string): Promise<{ pe: number | null }> {
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=summaryDetail`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  const detail = json?.quoteSummary?.result?.[0]?.summaryDetail
  if (!detail) throw new Error('no data')

  const pe = detail?.trailingPE?.raw
  return { pe: typeof pe === 'number' && isFinite(pe) && pe > 0 ? pe : null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse()

  try {
    const { symbols } = await req.json()
    if (!Array.isArray(symbols) || symbols.length === 0) {
      return errorResponse('symbols array required')
    }

    const toFetch = symbols.slice(0, 20) as string[]
    const result: Record<string, { pe: number | null }> = {}

    // Fetch sequentially to be polite
    for (const symbol of toFetch) {
      try {
        result[symbol] = await fetchYahooQuote(symbol)
      } catch {
        // Skip failed symbols
      }
    }

    return jsonResponse({ data: result })
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'unknown error', 500)
  }
})
