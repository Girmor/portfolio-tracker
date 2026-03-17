import { useState, useEffect, useMemo } from 'react'
import { fetchCryptoHistory, fetchStockHistory, fillForward, buildDayRange } from '../lib/historicalPrices'
import { tickerToCoinId } from '../lib/priceService'

// Returns true if we should use CoinGecko for this position.
// Handles cases where crypto was accidentally saved as type='stock'.
function isCryptoPosition(pos) {
  if (pos.type === 'crypto') return true
  if (pos.coin_id) return true
  const mapped = tickerToCoinId(pos.ticker)
  return mapped !== pos.ticker.toLowerCase()
}


/**
 * Builds a daily portfolio value timeline from trade data + historical prices.
 * @param {Array} positions - positions with trades loaded
 * Returns { points: Array<{date, dateStr, day, value, cost, pnl, pnlPercent}>, loading: boolean }
 */
export function useTradeHistory(positions) {
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
      const uniquePositions = positionsMeta.filter(pos => {
        if (seen.has(pos.ticker)) return false
        seen.add(pos.ticker)
        return true
      })

      const maps = new Map()
      for (let i = 0; i < uniquePositions.length; i++) {
        if (cancelled) return
        const pos = uniquePositions[i]
        try {
          let filled
          if (isCryptoPosition(pos)) {
            const raw = await fetchCryptoHistory(pos, daysTotal)
            filled = fillForward(raw, allDays)
          } else {
            const raw = await fetchStockHistory(pos.ticker, earliestDate)
            filled = fillForward(raw, allDays)
          }
          maps.set(pos.ticker, { filled, isCrypto: isCryptoPosition(pos) })
        } catch { /* skip */ }
        // small delay between requests to avoid CoinGecko rate limiting
        if (i < uniquePositions.length - 1) await new Promise(r => setTimeout(r, 600))
      }
      setPriceMaps(maps)
      setLoading(false)
    }

    fetchAll()
    return () => { cancelled = true }
  }, [earliestDate, positionsMeta])

  const points = useMemo(() => {
    if (!priceMaps || !earliestDate) return []

    const allDays = buildDayRange(earliestDate)

    // Precompute which tickers have at least one real price in their filled map.
    // Crypto with no real prices = rate limited (temporary) → skip, don't show fake 0%.
    // Stocks with no real prices = no API key (permanent) → use cost basis as fallback.
    const tickersWithRealPrices = new Set()
    for (const [ticker, { filled }] of priceMaps) {
      for (const val of filled.values()) {
        if (val !== null) { tickersWithRealPrices.add(ticker); break }
      }
    }

    const posTradesSorted = positionsMeta.map(pos => ({
      ticker: pos.ticker,
      isCrypto: isCryptoPosition(pos),
      trades: [...(pos.trades || [])].sort((a, b) =>
        (a.date || '').localeCompare(b.date || '')
      ),
    }))

    return allDays.map(day => {
      let totalValue = 0
      let totalCost = 0

      for (const { ticker, isCrypto, trades } of posTradesSorted) {
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

        const price = priceMaps.get(ticker)?.filled.get(day) ?? null

        let effectivePrice
        if (price !== null) {
          effectivePrice = price
        } else if (!isCrypto && !tickersWithRealPrices.has(ticker)) {
          // Stock with no historical price API → show cost basis (flat line, 0% return)
          effectivePrice = avgPrice
        } else {
          // Crypto with no data (rate limited) → skip to avoid misleading 0% return
          continue
        }

        if (effectivePrice <= 0) continue

        totalValue += qty * effectivePrice
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
