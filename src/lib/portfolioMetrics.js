/**
 * Portfolio analytics: TWR, P/E, Beta, Sharpe, Sortino
 * All computations are client-side; uses Alpha Vantage OVERVIEW + SPY price history.
 */

const RISK_FREE = 0.043 // US 5-year Treasury approximation

/**
 * Fetch Alpha Vantage OVERVIEW for a stock ticker.
 * Results are cached in sessionStorage to respect the 25 req/day free tier.
 * Returns { pe: number|null, beta: number|null } or null on failure.
 */
export async function fetchOverview(ticker) {
  // Use dedicated second key for metrics to avoid sharing quota with history/dividends
  const key = import.meta.env.VITE_ALPHAVANTAGE_KEY2 || import.meta.env.VITE_ALPHAVANTAGE_KEY
  if (!key) return null

  const cacheKey = `av_overview_${ticker}`
  try {
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) return JSON.parse(cached)
  } catch {}

  try {
    const res = await fetch(
      `https://www.alphavantage.co/query?function=OVERVIEW` +
      `&symbol=${encodeURIComponent(ticker)}&apikey=${key}`
    )
    if (!res.ok) return null
    const json = await res.json()
    // Rate-limited or invalid responses lack Symbol field
    if (!json.Symbol) return null

    const pe = parseFloat(json.PERatio)
    const beta = parseFloat(json.Beta)
    const result = {
      pe: isFinite(pe) ? pe : null,
      beta: isFinite(beta) ? beta : null,
    }
    try { sessionStorage.setItem(cacheKey, JSON.stringify(result)) } catch {}
    return result
  } catch {
    return null
  }
}

/**
 * Weighted-average P/E ratio across stock positions.
 * @param {Array} positions - raw position objects with ticker, type, trades[]
 * @param {Object} prices - map of ticker → current price
 * @param {Object} overviewData - map of ticker → { pe, beta }
 * @returns {number|null}
 */
export function computePE(positions, prices, overviewData) {
  let totalWeightedPE = 0
  let totalWeight = 0

  for (const pos of positions) {
    if (pos.type !== 'stock') continue
    const qty = calcQty(pos)
    if (qty <= 0) continue
    const price = prices[pos.ticker]
    if (!price) continue
    const ov = overviewData[pos.ticker]
    if (!ov?.pe || ov.pe <= 0 || ov.pe >= 200) continue

    const marketValue = qty * price
    totalWeightedPE += marketValue * ov.pe
    totalWeight += marketValue
  }

  return totalWeight > 0 ? totalWeightedPE / totalWeight : null
}

/**
 * Weighted-average Beta across stock positions.
 * @param {Array} positions - raw position objects
 * @param {Object} prices - map of ticker → current price
 * @param {Object} overviewData - map of ticker → { pe, beta }
 * @returns {number|null}
 */
export function computeBeta(positions, prices, overviewData) {
  let totalWeightedBeta = 0
  let totalWeight = 0

  for (const pos of positions) {
    if (pos.type !== 'stock') continue
    const qty = calcQty(pos)
    if (qty <= 0) continue
    const price = prices[pos.ticker]
    if (!price) continue
    const ov = overviewData[pos.ticker]
    if (!ov?.beta || ov.beta <= 0) continue

    const marketValue = qty * price
    totalWeightedBeta += marketValue * ov.beta
    totalWeight += marketValue
  }

  return totalWeight > 0 ? totalWeightedBeta / totalWeight : null
}

/**
 * Compute portfolio return (simplified) using a Modified Dietz approximation.
 * Returns { twr, annualizedReturn, startDate } — all null if insufficient data.
 * @param {Array} positions - raw position objects with trades[]
 * @param {Object} prices - map of ticker → current price
 */
export function computeTWR(positions, prices) {
  // Flatten all trades with their ticker
  const allTrades = []
  for (const pos of positions) {
    for (const t of (pos.trades || [])) {
      allTrades.push({ ...t, ticker: pos.ticker })
    }
  }

  if (allTrades.length === 0) return { twr: null, annualizedReturn: null, startDate: null }

  allTrades.sort((a, b) => new Date(a.date) - new Date(b.date))
  const startDate = allTrades[0].date

  // Net amount invested (buys cost money, sells return money)
  let totalNetInvested = 0
  for (const t of allTrades) {
    const amount = Number(t.quantity) * Number(t.price)
    if (t.type === 'buy') totalNetInvested += amount
    else totalNetInvested -= amount
  }

  // Current portfolio value
  let currentValue = 0
  for (const pos of positions) {
    const qty = calcQty(pos)
    if (qty > 0) {
      const price = prices[pos.ticker]
      if (price) currentValue += qty * price
    }
  }

  if (totalNetInvested <= 0) return { twr: null, annualizedReturn: null, startDate }

  const twr = (currentValue - totalNetInvested) / totalNetInvested

  // Annualize
  const daysHeld = Math.max(1, (Date.now() - new Date(startDate + 'T00:00:00Z').getTime()) / (1000 * 60 * 60 * 24))
  const yearsHeld = daysHeld / 365
  const annualizedReturn = yearsHeld >= 0.1
    ? Math.pow(Math.max(0, 1 + twr), 1 / yearsHeld) - 1
    : twr

  return { twr, annualizedReturn, startDate }
}

/**
 * Compute Sharpe and Sortino ratios using beta × SPY volatility as portfolio vol proxy.
 * Also returns SPY period return and benchmark ratios for comparison.
 * @param {number} annualizedReturn - portfolio annualized return (decimal)
 * @param {number} beta - portfolio beta
 * @param {Array} spyPrices - array of { date: ms, price } from getSpxHistoricalPrices()
 * @param {string} startDate - 'YYYY-MM-DD' portfolio inception date
 */
export function computeSharpeSortino(annualizedReturn, beta, spyPrices, startDate) {
  if (!spyPrices?.length || !startDate || beta == null || beta <= 0) {
    return { sharpe: null, sortino: null, spySharpe: null, spySortino: null, spyAnnualReturn: null }
  }

  const startMs = new Date(startDate + 'T00:00:00Z').getTime()
  const filtered = spyPrices.filter(p => p.date >= startMs).sort((a, b) => a.date - b.date)

  if (filtered.length < 10) {
    return { sharpe: null, sortino: null, spySharpe: null, spySortino: null, spyAnnualReturn: null }
  }

  // Daily log returns
  const returns = []
  for (let i = 1; i < filtered.length; i++) {
    returns.push(Math.log(filtered[i].price / filtered[i - 1].price))
  }

  const n = returns.length
  const mean = returns.reduce((s, r) => s + r, 0) / n

  // Annualized SPY return (geometric, using first/last prices)
  const daysTotal = Math.max(1, (filtered[filtered.length - 1].date - filtered[0].date) / (1000 * 60 * 60 * 24))
  const spyAnnualReturn = Math.pow(filtered[filtered.length - 1].price / filtered[0].price, 365 / daysTotal) - 1

  // SPY annual vol
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / n
  const spyAnnualVol = Math.sqrt(variance * 252)

  // SPY downside vol (semivariance, using negative returns relative to 0)
  const negReturns = returns.filter(r => r < 0)
  const downVariance = negReturns.length > 0
    ? negReturns.reduce((s, r) => s + r ** 2, 0) / negReturns.length
    : variance
  const spyDownsideVol = Math.sqrt(downVariance * 252)

  // Portfolio vol proxied by beta × SPY vol
  const portfolioSigma = beta * spyAnnualVol
  const portfolioDownsideSigma = beta * spyDownsideVol

  const sharpe = portfolioSigma > 0 ? (annualizedReturn - RISK_FREE) / portfolioSigma : null
  const sortino = portfolioDownsideSigma > 0 ? (annualizedReturn - RISK_FREE) / portfolioDownsideSigma : null
  const spySharpe = spyAnnualVol > 0 ? (spyAnnualReturn - RISK_FREE) / spyAnnualVol : null
  const spySortino = spyDownsideVol > 0 ? (spyAnnualReturn - RISK_FREE) / spyDownsideVol : null

  return { sharpe, sortino, spySharpe, spySortino, spyAnnualReturn }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function calcQty(pos) {
  let buy = 0, sell = 0
  for (const t of (pos.trades || [])) {
    if (t.type === 'buy') buy += Number(t.quantity)
    else sell += Number(t.quantity)
  }
  return buy - sell
}
