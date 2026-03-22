import { useState, useEffect, useRef, useMemo } from 'react'
import { fetchCryptoHistory, fetchStockHistory, fillForward, buildDayRange } from '../lib/historicalPrices'
import { tickerToCoinId } from '../lib/priceService'

function isCryptoPosition(pos) {
  if (pos.type === 'crypto') return true
  if (pos.coin_id) return true
  const mapped = tickerToCoinId(pos.ticker)
  return mapped !== pos.ticker.toLowerCase()
}

export function useTradeHistory(positions) {
  const [priceMaps, setPriceMaps] = useState(null)
  const [loading, setLoading] = useState(false)

  // Stable string key derived from ticker identities + earliest date only.
  // This does NOT change when live prices refresh (every 60s), so the historical
  // fetch waterfall only re-runs when tickers or trade dates actually change.
  const fetchKey = useMemo(() => {
    if (!positions?.length) return null
    let earliest = null
    const tickers = []
    for (const pos of positions) {
      tickers.push(`${pos.ticker}|${pos.coin_id || ''}|${pos.type || ''}`)
      for (const t of (pos.trades || [])) {
        const d = t.date?.split('T')[0]
        if (d && (!earliest || d < earliest)) earliest = d
      }
    }
    if (!earliest) return null
    return `${earliest}||${tickers.sort().join(',')}`
  }, [positions])

  // Keep a ref to positions so the fetch effect can read it without it being a dep.
  const positionsRef = useRef(positions)
  useEffect(() => { positionsRef.current = positions }, [positions])

  useEffect(() => {
    if (!fetchKey) {
      setPriceMaps(null)
      return
    }

    let cancelled = false
    setLoading(true)

    async function fetchAll() {
      const currentPositions = positionsRef.current
      if (!currentPositions?.length) return

      let earliestDate = null
      for (const pos of currentPositions) {
        for (const t of (pos.trades || [])) {
          const d = t.date?.split('T')[0]
          if (d && (!earliestDate || d < earliestDate)) earliestDate = d
        }
      }
      if (!earliestDate) { setLoading(false); return }

      const today = new Date().toISOString().split('T')[0]
      const daysTotal = Math.ceil(
        (new Date(today) - new Date(earliestDate)) / (1000 * 60 * 60 * 24)
      ) + 2

      const allDays = buildDayRange(earliestDate)

      const seen = new Set()
      const uniquePositions = currentPositions.filter(pos => {
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
        if (i < uniquePositions.length - 1) await new Promise(r => setTimeout(r, 600))
      }

      // Fix #7: check cancelled before updating state to avoid setState after unmount
      if (cancelled) return
      setPriceMaps(maps)
      setLoading(false)
    }

    fetchAll()
    return () => { cancelled = true }
  }, [fetchKey]) // only re-fetches when tickers/dates change, not on price refresh

  // Fix #8: split into two memos — trade calc (stable) and point building (needs priceMaps)
  const posTradesSorted = useMemo(() => {
    if (!positions?.length) return []
    return positions.map(pos => ({
      ticker: pos.ticker,
      isCrypto: isCryptoPosition(pos),
      trades: [...(pos.trades || [])].sort((a, b) =>
        (a.date || '').localeCompare(b.date || '')
      ),
    }))
  }, [positions])

  const earliestDate = useMemo(() => {
    if (!positions?.length) return null
    let earliest = null
    for (const pos of positions) {
      for (const t of (pos.trades || [])) {
        const d = t.date?.split('T')[0]
        if (d && (!earliest || d < earliest)) earliest = d
      }
    }
    return earliest
  }, [positions])

  const points = useMemo(() => {
    if (!priceMaps || !earliestDate) return []

    const allDays = buildDayRange(earliestDate)

    const tickersWithRealPrices = new Set()
    for (const [ticker, { filled }] of priceMaps) {
      for (const val of filled.values()) {
        if (val !== null) { tickersWithRealPrices.add(ticker); break }
      }
    }

    return allDays.map(day => {
      let totalValue = 0
      let totalBuyCostAll = 0
      let totalSellProceeds = 0

      for (const { ticker, isCrypto, trades } of posTradesSorted) {
        let totalBuyQty = 0
        let totalBuyCost = 0
        let totalSellQty = 0
        let sellProceeds = 0

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
            sellProceeds += p * q
          }
        }

        // No trades yet for this day
        if (totalBuyQty === 0 && totalSellQty === 0) continue

        totalBuyCostAll += totalBuyCost
        totalSellProceeds += sellProceeds

        const qty = totalBuyQty - totalSellQty
        if (qty <= 0) continue // fully sold — cost and proceeds already counted

        const avgPrice = totalBuyQty > 0 ? totalBuyCost / totalBuyQty : 0
        const price = priceMaps.get(ticker)?.filled.get(day) ?? null

        let effectivePrice
        if (price !== null) {
          effectivePrice = price
        } else if (!isCrypto && !tickersWithRealPrices.has(ticker)) {
          effectivePrice = avgPrice // stocks without price API → show cost basis
        } else {
          continue // crypto rate-limited → skip, don't show fake 0%
        }

        if (effectivePrice <= 0) continue
        totalValue += qty * effectivePrice
      }

      // Total P&L = (current market value + sell proceeds) - total buy cost
      const pnl = (totalValue + totalSellProceeds) - totalBuyCostAll
      const pnlPercent = totalBuyCostAll > 0 ? (pnl / totalBuyCostAll) * 100 : 0

      return {
        date: new Date(day + 'T00:00:00Z').getTime(),
        dateStr: new Date(day + 'T00:00:00Z').toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' }),
        day,
        value: totalValue,
        cost: totalBuyCostAll,
        pnl,
        pnlPercent: isFinite(pnlPercent) ? pnlPercent : 0,
      }
    }).filter(p => p.value > 0 || p.cost > 0)
  }, [priceMaps, earliestDate, posTradesSorted])

  return { points, loading }
}
