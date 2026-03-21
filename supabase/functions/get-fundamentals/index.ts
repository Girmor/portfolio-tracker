import { corsHeaders, corsResponse, jsonResponse, errorResponse } from '../_shared/cors.ts'

const FINNHUB_KEY = Deno.env.get('FINNHUB_KEY') ?? ''

/**
 * Fetch P/E and Beta for a ticker from Yahoo Finance quoteSummary (server-side).
 */
async function fetchYahooMetrics(ticker: string): Promise<{ pe: number | null; beta: number | null }> {
  try {
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=defaultKeyStatistics,summaryDetail`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    if (!res.ok) return { pe: null, beta: null }
    const json = await res.json()
    const r = json.quoteSummary?.result?.[0]
    if (!r) return { pe: null, beta: null }

    const ks = r.defaultKeyStatistics
    const sd = r.summaryDetail

    const peRaw = sd?.trailingPE?.raw ?? ks?.forwardPE?.raw ?? null
    const pe = peRaw != null && isFinite(peRaw) ? peRaw : null
    const betaRaw = ks?.beta?.raw ?? null
    const beta = betaRaw != null && isFinite(betaRaw) ? betaRaw : null

    return { pe, beta }
  } catch {
    return { pe: null, beta: null }
  }
}

/**
 * Fetch SPY 5-year daily candles from Finnhub.
 */
async function fetchSpyHistory(): Promise<Array<{ date: number; price: number }>> {
  if (!FINNHUB_KEY) return []
  try {
    const from = Math.floor(Date.now() / 1000) - 5 * 365 * 24 * 60 * 60
    const to = Math.floor(Date.now() / 1000)
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/candle?symbol=SPY&resolution=D&from=${from}&to=${to}&token=${FINNHUB_KEY}`
    )
    if (!res.ok) return []
    const data = await res.json()
    if (data.s !== 'ok' || !data.t?.length) return []
    return data.t.map((ts: number, i: number) => ({ date: ts * 1000, price: data.c[i] }))
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
          const m = await fetchYahooMetrics(ticker)
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
