import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, corsResponse, jsonResponse, errorResponse } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const FINNHUB_KEY = Deno.env.get('FINNHUB_KEY') ?? ''

interface Position {
  id: string
  ticker: string
  type: string
  portfolio_id: string
  coin_id?: string | null
}

interface Trade {
  position_id: string
  type: string
  quantity: number
  price: number
}

interface Portfolio {
  id: string
  name: string
  cash_balance: number
}

async function fetchPrices(
  cryptoIds: string[],
  stockTickers: string[]
): Promise<Record<string, number>> {
  const prices: Record<string, number> = {}

  // Fetch crypto prices
  if (cryptoIds.length > 0) {
    try {
      const ids = [...new Set(cryptoIds)].map(id => encodeURIComponent(id)).join(',')
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`
      )
      if (res.ok) {
        const data = await res.json()
        for (const id of cryptoIds) {
          if (data[id]?.usd != null) prices[id] = data[id].usd
        }
      }
    } catch { /* skip */ }
  }

  // Fetch stock prices
  if (stockTickers.length > 0 && FINNHUB_KEY) {
    await Promise.all(
      [...new Set(stockTickers)].map(async ticker => {
        try {
          const res = await fetch(
            `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_KEY}`
          )
          if (res.ok) {
            const data = await res.json()
            if (data.c) prices[ticker] = data.c
          }
        } catch { /* skip */ }
      })
    )
  }

  return prices
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse()

  try {
    const { label, portfolioId } = await req.json().catch(() => ({})) as {
      label?: string
      portfolioId?: string
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // Fetch all data
    const positionsQuery = supabase.from('positions').select('*')
    const tradesQuery = supabase.from('trades').select('*')
    const portfoliosQuery = supabase.from('portfolios').select('*')
    const budgetQuery = supabase.from('budget').select('*')

    const [
      { data: positions },
      { data: trades },
      { data: portfolios },
      { data: budget },
    ] = await Promise.all([positionsQuery, tradesQuery, portfoliosQuery, budgetQuery])

    const allPositions: Position[] = positions || []
    const allTrades: Trade[] = trades || []
    const allPortfolios: Portfolio[] = portfolios || []
    const allBudget = budget || []

    // Filter by portfolioId if provided
    const targetPortfolios = portfolioId
      ? allPortfolios.filter(p => p.id === portfolioId)
      : allPortfolios

    const targetPositions = portfolioId
      ? allPositions.filter(p => p.portfolio_id === portfolioId)
      : allPositions

    // Prepare price fetch inputs
    const cryptoPositions = targetPositions.filter(p => p.type === 'crypto')
    const stockPositions = targetPositions.filter(p => p.type === 'stock')
    const cryptoIds = cryptoPositions.map(p => p.coin_id || p.ticker.toLowerCase())
    const stockTickers = stockPositions.map(p => p.ticker)

    // Fetch prices
    const priceData = await fetchPrices(cryptoIds, stockTickers)

    // Map prices by ticker
    const priceMap: Record<string, number> = {}
    cryptoPositions.forEach((p, i) => {
      const price = priceData[cryptoIds[i]]
      if (price != null) priceMap[p.ticker] = price
    })
    stockPositions.forEach(p => {
      const price = priceData[p.ticker]
      if (price != null) priceMap[p.ticker] = price
    })

    // Compute portfolio values
    const byPortfolio: Record<string, {
      totalValue: number
      totalCost: number
      totalPnl: number
      totalPnlPercent: number
    }> = {}

    let overallValue = 0
    let overallCost = 0

    for (const pf of targetPortfolios) {
      const pfPositions = allPositions.filter(p => p.portfolio_id === pf.id)
      let pfValue = Number(pf.cash_balance) || 0
      let pfCost = 0

      for (const pos of pfPositions) {
        const posTrades = allTrades.filter(t => t.position_id === pos.id)
        let buyQty = 0, buyCost = 0, sellQty = 0

        posTrades.forEach(t => {
          const qty = Number(t.quantity)
          const price = Number(t.price)
          if (t.type === 'buy') { buyQty += qty; buyCost += price * qty }
          else { sellQty += qty }
        })

        const remainQty = buyQty - sellQty
        const avgPrice = buyQty > 0 ? buyCost / buyQty : 0
        const invested = avgPrice * remainQty
        const currentPrice = priceMap[pos.ticker] ?? 0
        const mktValue = remainQty * currentPrice

        if (remainQty > 0) {
          pfValue += mktValue
          pfCost += invested
        }
      }

      const pfPnl = pfValue - pfCost - (Number(pf.cash_balance) || 0)
      const pfPnlPercent = pfCost > 0 ? (pfPnl / pfCost) * 100 : 0

      byPortfolio[pf.id] = {
        totalValue: pfValue,
        totalCost: pfCost,
        totalPnl: pfPnl,
        totalPnlPercent: pfPnlPercent,
      }

      overallValue += pfValue
      overallCost += pfCost
    }

    // Budget total in USD
    const budgetTotalUsd = allBudget.reduce((sum: number, b: { currency: string, amount: number }) => {
      if (b.currency === 'USD') return sum + Number(b.amount)
      if (b.currency === 'EUR') return sum + Number(b.amount) * 1.08
      if (b.currency === 'UAH') return sum + Number(b.amount) / 41.5
      return sum + Number(b.amount)
    }, 0)

    const overallPnl = overallValue - overallCost
    const overallPnlPercent = overallCost > 0 ? (overallPnl / overallCost) * 100 : 0

    // Write snapshot
    const { data: snapshot, error: snapshotErr } = await supabase
      .from('snapshots')
      .insert({
        label: label || `Auto ${new Date().toISOString().split('T')[0]}`,
        data: {
          positions: targetPositions,
          trades: allTrades,
          budget: allBudget,
          portfolios: targetPortfolios,
          budgetTotalUsd,
          computed: {
            byPortfolio,
            overall: {
              totalValue: overallValue,
              totalCost: overallCost,
              totalPnl: overallPnl,
              totalPnlPercent: overallPnlPercent,
            },
            prices: priceMap,
          },
        },
      })
      .select('id')
      .single()

    if (snapshotErr) {
      return errorResponse(`Failed to save snapshot: ${snapshotErr.message}`, 500)
    }

    return jsonResponse({
      snapshotId: snapshot.id,
      totalValue: overallValue,
      byPortfolio,
    })
  } catch (err) {
    return errorResponse(`Internal error: ${err instanceof Error ? err.message : String(err)}`, 500)
  }
})
