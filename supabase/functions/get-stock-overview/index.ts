import { corsResponse, jsonResponse, errorResponse } from '../_shared/cors.ts'

/**
 * Edge Function: get-stock-overview
 *
 * Fetches P/E ratio from Yahoo Finance (works for stocks AND ETFs).
 * Uses crumb/cookie authentication flow.
 * Runs server-side to avoid CORS.
 *
 * POST body: { symbols: ['WMT', 'JEPI', ...] }
 * Response:  { data: { WMT: { pe: 36.5 }, JEPI: { pe: 12.1 }, ... } }
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'

/** Obtain Yahoo Finance crumb + cookie for authenticated API access. */
async function getYahooCrumb(): Promise<{ crumb: string; cookie: string }> {
  // Step 1: Hit fc.yahoo.com to get session cookie
  const initRes = await fetch('https://fc.yahoo.com/', {
    headers: { 'User-Agent': UA },
    redirect: 'manual',
  })
  // Extract Set-Cookie header
  const setCookie = initRes.headers.get('set-cookie')
  if (!setCookie) throw new Error('no cookie from Yahoo')
  // Parse just the cookie value (A3=...)
  const cookieMatch = setCookie.match(/A3=[^;]+/)
  const cookie = cookieMatch ? cookieMatch[0] : ''
  // Consume body
  await initRes.text()

  // Step 2: Get crumb using the cookie
  const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, 'Cookie': cookie },
  })
  if (!crumbRes.ok) throw new Error(`crumb HTTP ${crumbRes.status}`)
  const crumb = await crumbRes.text()
  if (!crumb || crumb.startsWith('{')) throw new Error('invalid crumb')

  return { crumb, cookie }
}

async function fetchYahooQuote(
  symbol: string,
  crumb: string,
  cookie: string,
): Promise<{ pe: number | null }> {
  const url =
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
    `?modules=summaryDetail&crumb=${encodeURIComponent(crumb)}`
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Cookie': cookie },
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

    // Get auth credentials first
    const { crumb, cookie } = await getYahooCrumb()

    const toFetch = symbols.slice(0, 20) as string[]
    const result: Record<string, { pe: number | null }> = {}

    // Fetch sequentially to be polite
    for (const symbol of toFetch) {
      try {
        result[symbol] = await fetchYahooQuote(symbol, crumb, cookie)
      } catch {
        // Skip failed symbols
      }
    }

    return jsonResponse({ data: result })
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'unknown error', 500)
  }
})
