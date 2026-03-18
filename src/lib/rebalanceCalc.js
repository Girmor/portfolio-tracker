/**
 * Pure rebalance calculation function.
 *
 * @param {Object} params
 * @param {Array}  params.assets          - template assets (includedInRebalance, symbol, targetPercent, name, category)
 * @param {Object} params.currentValues   - { [symbol]: dollarValue }
 * @param {number} params.cashBalance     - current cash (USD) in portfolio
 * @param {number} params.deposit         - additional deposit (positive number)
 * @param {number} params.withdrawal      - withdrawal amount (positive number)
 * @param {boolean} params.allowSales     - whether selling is allowed
 * @param {Object} params.prices          - { [symbol]: pricePerUnit }
 * @param {Set}    params.excludedSymbols - symbols excluded for this run
 *
 * @returns {Array<{
 *   symbol, name, category,
 *   currentValue, currentPct,
 *   targetPct, targetValue,
 *   delta,    // positive = buy, negative = sell
 *   units,    // abs(delta) / price
 *   action,   // 'buy' | 'sell' | 'hold' | 'excluded'
 * }>}
 */
export function calculateRebalance({
  assets,
  currentValues,
  cashBalance,
  deposit = 0,
  withdrawal = 0,
  allowSales = false,
  prices = {},
  excludedSymbols = new Set(),
}) {
  const includedAssets = assets.filter(a => a.includedInRebalance && !excludedSymbols.has(a.symbol))
  const excludedAssets = assets.filter(a => !a.includedInRebalance || excludedSymbols.has(a.symbol))

  // Sum of market values for included assets
  const includedCurrentTotal = includedAssets.reduce(
    (sum, a) => sum + (currentValues[a.symbol] ?? 0),
    0
  )

  // Total portfolio value after deposit/withdrawal
  const targetPortfolioValue = includedCurrentTotal + cashBalance + deposit - withdrawal

  // Normalize target percentages to 100% across included assets only.
  // When an asset is excluded its allocation is redistributed proportionally
  // to the remaining active assets, increasing their buying power.
  const totalIncludedPct = includedAssets.reduce((s, a) => s + (a.targetPercent || 0), 0)

  // Calculate raw deltas
  let results = includedAssets.map(a => {
    const currentValue = currentValues[a.symbol] ?? 0
    const normalizedPct = totalIncludedPct > 0 ? (a.targetPercent / totalIncludedPct) * 100 : 0
    const targetValue = (targetPortfolioValue * normalizedPct) / 100
    const delta = targetValue - currentValue
    return { ...a, currentValue, targetValue, delta, normalizedPct }
  })

  if (!allowSales) {
    // Zero out sells, then scale down buys if we can't afford them
    results = results.map(r => ({ ...r, delta: Math.max(0, r.delta) }))

    const totalBuyNeeded = results.reduce((s, r) => s + r.delta, 0)
    const availableCash = cashBalance + deposit - withdrawal

    if (totalBuyNeeded > availableCash && totalBuyNeeded > 0) {
      const scale = availableCash / totalBuyNeeded
      results = results.map(r => ({ ...r, delta: r.delta * scale }))
    }
  } else {
    // Cap sells at current position value (can't sell more than you own)
    results = results.map(r => ({
      ...r,
      delta: r.delta < 0 ? Math.max(r.delta, -r.currentValue) : r.delta,
    }))
  }

  // Total value for current pct calculation
  const totalCurrentForPct = assets.reduce((sum, a) => sum + (currentValues[a.symbol] ?? 0), 0) + cashBalance

  const mappedIncluded = results.map(r => {
    const price = prices[r.symbol] ?? 0
    const units = price > 0 ? Math.abs(r.delta) / price : 0
    let action = 'hold'
    if (Math.abs(r.delta) > 0.005) {
      action = r.delta > 0 ? 'buy' : 'sell'
    }
    const currentPct = totalCurrentForPct > 0 ? (r.currentValue / totalCurrentForPct) * 100 : 0
    return {
      symbol: r.symbol,
      name: r.name,
      category: r.category,
      currentValue: r.currentValue,
      currentPct,
      targetPct: r.normalizedPct,      // show effective (normalized) target %
      originalTargetPct: r.targetPercent, // original template %
      targetValue: r.targetValue,
      delta: r.delta,
      units,
      action,
    }
  })

  const mappedExcluded = excludedAssets.map(a => {
    const currentValue = currentValues[a.symbol] ?? 0
    const currentPct = totalCurrentForPct > 0 ? (currentValue / totalCurrentForPct) * 100 : 0
    return {
      symbol: a.symbol,
      name: a.name,
      category: a.category,
      currentValue,
      currentPct,
      targetPct: a.targetPercent,
      targetValue: 0,
      delta: 0,
      units: 0,
      action: 'excluded',
    }
  })

  return [...mappedIncluded, ...mappedExcluded]
}
