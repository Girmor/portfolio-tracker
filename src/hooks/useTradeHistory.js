import { useState, useEffect, useMemo } from 'react'
import { fetchCryptoHistory, fillForward, buildDayRange } from '../lib/historicalPrices'
import { tickerToCoinId } from '../lib/priceService'

// Returns true if we should use CoinGecko for this position.
// Handles cases where crypto was accidentally saved as type='stock'.
function isCryptoPosition(pos) {
  if (pos.type === 'crypto') return true
  if (pos.coin_id) return true
  const mapped = tickerToCoinId(pos.ticker)
  return mapped !== pos.ticker.toLowerCase()
}

// Builds a synthetic price map for a stock using trade prices + current price.
// Fills from first trade date with buy price, ending at today's current price.
function buildStockFallbackMap(trades, currentPrice, allDays) {
  const sortedTrades = [...trades].sort((a, b) =>
    (a.date || '').localeCompare(b.date || '')
  )
  const raw = new Map()
  for (const t of sortedTrades) {
    const d = t.date?.split('T')[0]
    if (d) raw.set(d, Number(t.price) || 0)
  }
  // Add today's current price as the endpoint
  if (currentPrice) {
    const today = new Date().toISOString().split('T')[0]
    raw.set(today, currentPrice)
  }
  return fillForward(raw, allDays)
}

/**
 * Builds a daily portfolio value timeline from trade data + historical prices.
 * @param {Array} positions - positions with trades loaded
 * @param {Object} currentPrices - map of ticker → current price (for stock fallback)
 * Returns { points: Array<{date, dateStr, day, value, cost, pnl, pnlPercent}>, loading: boolean }
 */
export function useTradeHistory(positions, currentPrices = {}) {
  const [priceMaps, setPriceMaps] = useState(null)
  const [loading, setLoading] = useState(false)

  const { earliestDate, positionsMeta } = useMemo(() => {
    if (!positions?.length) return { earliestDate: null, positionsMeta: [] }
    let earliest = null
    const meta = positions.map(pos => {
      for (const t of (pos.trades || [])) {
        const d = t.date?.split('T')[0]
        if (d && (!earliest || d < earliest)) earliest = d
      }
      return pos
    })
    return { earliestDate: earliest, positionsMeta: meta }
  }, [positions])

  useEffect(() => {
    if (!earliestDate || !positionsMeta.length) {
      setPriceMaps(null)
      return
    }

    let cancelled = false
    setLoading(true)

    async function fetchAll() {
      const today = new Date().toISOString().split('T')[0]
      const daysTotal = Math.ceil(
        (new Date(today) - new Date(earliestDate)) / (1000 * 60 * 60 * 24)
      ) + 2

      const allDays = buildDayRange(earliestDate)

      const seen = new Set()
      const fetchPromises = positionsMeta
        .filter(pos => {
          if (seen.has(pos.ticker)) return false
          seen.add(pos.ticker)
          return true
        })
        .map(async pos => {
          let filled
          if (isCryptoPosition(pos)) {
            const raw = await fetchCryptoHistory(pos, daysTotal)
            filled = fillForward(raw, allDays)
          } else {
            // Stocks: Finnhub historical candles require paid plan.
            // Fall back to a synthetic map: buy price on purchase date → current price today.
            filled = buildStockFallbackMap(pos.trades || [], currentPrices[pos.ticker], allDays)
          }
          return [pos.ticker, filled]
        })

      const results = await Promise.allSettled(fetchPromises)
      if (cancelled) return

      const maps = new Map()
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const [ticker, filled] = r.value
          maps.set(ticker, filled)
        }
      }
      setPriceMaps(maps)
      setLoading(false)
    }

    fetchAll()
    return () => { cancelled = true }
  }, [earliestDate, positionsMeta, currentPrices])

  const points = useMemo(() => {
    if (!priceMaps || !earliestDate) return []

    const allDays = buildDayRange(earliestDate)

    const posTradesSorted = positionsMeta.map(pos => ({
      ticker: pos.ticker,
      trades: [...(pos.trades || [])].sort((a, b) =>
        (a.date || '').localeCompare(b.date || '')
      ),
    }))

    return allDays.map(day => {
      let totalValue = 0
      let totalCost = 0

      for (const { ticker, trades } of posTradesSorted) {
        let totalBuyQty = 0
        let totalBuyCost = 0
        let totalSellQty = 0

        for (const t of trades) {
          const d = t.date?.split('T')[0]
          if (!d || d > day) break
          const q = Number(t.quantity) || 0
          const p = Number(t.price) || 0
          if (t.type === 'buy') {
            totalBuyQty += q
            totalBuyCost += p * q
          } else {
            totalSellQty += q
          }
        }

        const qty = totalBuyQty - totalSellQty
        if (qty <= 0) continue

        const avgPrice = totalBuyQty > 0 ? totalBuyCost / totalBuyQty : 0
        const cost = avgPrice * qty

        const price = priceMaps.get(ticker)?.get(day) ?? null
        if (price === null) continue

        totalValue += qty * price
        totalCost += cost
      }

      const pnl = totalValue - totalCost
      const pnlPercent = totalCost > 0 ? (pnl / totalCost) * 100 : 0

      return {
        date: new Date(day + 'T00:00:00Z').getTime(),
        dateStr: new Date(day + 'T00:00:00Z').toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' }),
        day,
        value: totalValue,
        cost: totalCost,
        pnl,
        pnlPercent: isFinite(pnlPercent) ? pnlPercent : 0,
      }
    }).filter(p => p.value > 0 || p.cost > 0)
  }, [priceMaps, earliestDate, positionsMeta])

  return { points, loading }
}
