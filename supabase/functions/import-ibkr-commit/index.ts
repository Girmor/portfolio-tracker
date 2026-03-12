import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, corsResponse, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { parseIBKRCsv, tradeFingerprint } from '../_shared/ibkrParser.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse()

  try {
    const { portfolioId, csvText, filename, skipDuplicates = true } = await req.json() as {
      portfolioId: string
      csvText: string
      filename: string
      skipDuplicates?: boolean
    }

    if (!portfolioId) return errorResponse('portfolioId is required')
    if (!csvText) return errorResponse('csvText is required')

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // Resolve calling user's ID from the JWT so the import record gets user_id set.
    // Without this, the service-role INSERT creates the record with user_id = NULL,
    // and the RLS SELECT policy (user_id = auth.uid()) makes it invisible to the user.
    const authHeader = req.headers.get('Authorization')
    let userId: string | null = null
    if (authHeader) {
      const authResult = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
      userId = authResult.data?.user?.id ?? null
    }

    // Re-parse CSV
    const parsed = parseIBKRCsv(csvText)

    // Detect duplicates server-side
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

    // Filter out duplicates if skipDuplicates is true
    const tradesToImport = skipDuplicates
      ? parsed.trades.filter(t => !existingFingerprints.has(tradeFingerprint(t)))
      : parsed.trades

    const skippedDuplicates = parsed.trades.length - tradesToImport.length

    // Build summary
    const allTickers = [
      ...tradesToImport.map(t => t.symbol),
      ...parsed.dividends.map(d => d.ticker),
    ]
    const uniqueTickers = [...new Set(allTickers)].sort()
    const allDates = [
      ...tradesToImport.map(t => t.date),
      ...parsed.dividends.map(d => d.date),
    ].sort()

    const summary = {
      tickers: uniqueTickers,
      date_range: allDates.length > 0
        ? { from: allDates[0], to: allDates[allDates.length - 1] }
        : null,
      ending_cash: parsed.endingCash,
      dividend_count: parsed.dividends.length,
      dividend_total: parsed.dividends.reduce((s, d) => s + d.amount, 0),
    }

    // Call the stored procedure — handles everything in one transaction
    const { data: result, error } = await supabase.rpc('commit_ibkr_import', {
      p_portfolio_id: portfolioId,
      p_filename: filename || 'unknown.csv',
      p_broker: 'ibkr',
      p_trades: tradesToImport,
      p_dividends: parsed.dividends,
      p_ending_cash: parsed.endingCash,
      p_summary: summary,
      p_user_id: userId,
    })

    if (error) {
      return errorResponse(`Import failed: ${error.message}`, 500)
    }

    return jsonResponse({
      importId: result.importId,
      tradesImported: result.tradesImported,
      dividendsImported: result.dividendsImported,
      skippedDuplicates,
      parseErrors: parsed.errors,
    })
  } catch (err) {
    return errorResponse(`Internal error: ${err instanceof Error ? err.message : String(err)}`, 500)
  }
})
