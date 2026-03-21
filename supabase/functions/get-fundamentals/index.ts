import { corsHeaders, corsResponse, jsonResponse, errorResponse } from '../_shared/cors.ts'

const FINNHUB_KEY = Deno.env.get('FINNHUB_KEY') ?? ''

/**
 * Fetch P/E and Beta for a ticker via Finnhub /stock/metric (server-side).
 */
async function fetchFinnhubMetrics(ticker: string): Promise<{ pe: number | null; beta: number | null }> {
  if (!FINNHUB_KEY) return { pe: null, beta: null }
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all&token=${FINNHUB_KEY}`
    )
    if (!res.ok) return { pe: null, beta: null }
    const json = await res.json()
    const m = json.metric
    if (!m || typeof m !== 'object') return { pe: null, beta: null }

    const peRaw = m.peTTM ?? m.peBasicExclExtraTTM ?? m.peNormalizedAnnual ?? null
    const pe = peRaw != null && isFinite(Number(peRaw)) && Number(peRaw) > 0 && Number(peRaw) < 500
      ? Number(peRaw) : null
    const betaRaw = m.beta ?? null
    const beta = betaRaw != null && isFinite(Number(betaRaw)) ? Number(betaRaw) : null

    return { pe, beta }
  } catch {
    return { pe: null, beta: null }
  }
}

/**
 * Fetch SPY 2-year daily candles from Finnhub.
 */
async function fetchSpyHistory(): Promise<Array<{ date: number; price: number }>> {
  if (!FINNHUB_KEY) return []
  try {
    const to = Math.floor(Date.now() / 1000)
    const from = to - 2 * 365 * 24 * 60 * 60  // 2 years
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/candle?symbol=SPY&resolution=D&from=${from}&to=${to}&token=${FINNHUB_KEY}`
    )
    if (!res.ok) return []
    const data = await res.json()
    if (data.s !== 'ok' || !data.t?.length) return []
    return (data.t as number[]).map((ts: number, i: number) => ({ date: ts * 1000, price: data.c[i] }))
  } catch {
    return []
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return corsResponse()

  try {
    const { tickers = [], includeSpy = false } = await req.json()

    const [metricsResults, spyPrices] = await Promise.all([
      Promise.all(
        (tickers as string[]).map(async (ticker) => {
          const m = await fetchFinnhubMetrics(ticker)
          return [ticker, m] as [string, typeof m]
        })
      ),
      includeSpy ? fetchSpyHistory() : Promise.resolve([]),
    ])

    const metrics: Record<string, { pe: number | null; beta: number | null }> = {}
    for (const [ticker, m] of metricsResults) {
      metrics[ticker] = m
    }

    return jsonResponse({ metrics, spyPrices })
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Unknown error')
  }
})
