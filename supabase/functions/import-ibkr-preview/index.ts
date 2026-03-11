import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, corsResponse, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { parseIBKRCsv, tradeFingerprint } from '../_shared/ibkrParser.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse()

  try {
    const { portfolioId, csvText } = await req.json() as {
      portfolioId: string
      csvText: string
    }

    if (!portfolioId) return errorResponse('portfolioId is required')
    if (!csvText) return errorResponse('csvText is required')

    // Parse the CSV
    const parsed = parseIBKRCsv(csvText)

    // Fetch existing trades for duplicate detection (server-side)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    const { data: existingPositions } = await supabase
      .from('positions')
      .select('ticker, trades(date, type, quantity, price)')
      .eq('portfolio_id', portfolioId)

    const existingFingerprints = new Set<string>()
    for (const pos of (existingPositions || [])) {
      for (const t of (pos.trades || [])) {
        existingFingerprints.add(
          `${pos.ticker}|${t.date}|${t.type}|${Number(t.quantity)}|${Number(t.price)}`
        )
      }
    }

    // Mark duplicates in preview
    const tradesWithStatus = parsed.trades.map(t => ({
      ...t,
      isDuplicate: existingFingerprints.has(tradeFingerprint(t)),
    }))

    return jsonResponse({
      trades: tradesWithStatus,
      dividends: parsed.dividends,
      endingCash: parsed.endingCash,
      startingCash: parsed.startingCash,
      summary: {
        total: parsed.trades.length,
        newTrades: tradesWithStatus.filter(t => !t.isDuplicate).length,
        duplicates: tradesWithStatus.filter(t => t.isDuplicate).length,
        dividendCount: parsed.dividends.length,
        dividendTotal: parsed.dividends.reduce((s, d) => s + d.amount, 0),
      },
      parseErrors: parsed.errors,
    })
  } catch (err) {
    return errorResponse(`Internal error: ${err instanceof Error ? err.message : String(err)}`, 500)
  }
})
