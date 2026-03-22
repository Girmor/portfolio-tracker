/**
 * Portfolio analytics: TWR, P/E, Beta, Sharpe, Sortino
 *
 * Beta — computed from daily price history (ticker vs SPY). Works for both
 *        stocks and ETFs. No external API required beyond what's already cached.
 * P/E  — Yahoo Finance via Edge Function (works for stocks AND ETFs), localStorage cached.
 *        Falls back to Alpha Vantage OVERVIEW for stocks.
 * SPY  — fetchStockHistory('SPY') via stooq Edge Function, localStorage cached.
 */

import { fetchStockHistory } from './historicalPrices.js'
import { supabase } from './supabase.js'

const RISK_FREE = 0.043 // US 5-year Treasury approximation

// ---------------------------------------------------------------------------
// SPY price history
// ---------------------------------------------------------------------------

/**
 * Fetch SPY historical prices as [{date: ms, price}] array.
 * Uses Alpha Vantage TIME_SERIES_DAILY, localStorage cached (fetched once ever).
 */
export async function fetchSpyPrices() {
  try {
    const spyMap = await fetchStockHistory('SPY')
    if (!spyMap?.size) return []
    return [...spyMap.entries()]
      .map(([day, price]) => ({ date: new Date(day + 'T00:00:00Z').getTime(), price }))
      .sort((a, b) => a.date - b.date)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// P/E via Yahoo Finance Edge Function (stocks + ETFs), localStorage cached
// ---------------------------------------------------------------------------

const PE_CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

function getPECache(ticker) {
  try {
    const raw = localStorage.getItem(`pe_${ticker}`)
    if (!raw) return null
    const { pe, ts } = JSON.parse(raw)
    if (Date.now() - ts > PE_CACHE_TTL) return null
    return { pe }
  } catch { return null }
}

function setPECache(ticker, pe) {
  try {
    localStorage.setItem(`pe_${ticker}`, JSON.stringify({ pe, ts: Date.now() }))
  } catch {}
}

/**
 * Fetch P/E for multiple tickers via get-stock-overview Edge Function (Yahoo Finance).
 * Returns map of ticker → { pe }.
 */
export async function fetchOverviewAll(tickers) {
  if (!tickers?.length) return {}

  const result = {}
  const toFetch = []

  // Check localStorage cache first
  for (const ticker of tickers) {
    const cached = getPECache(ticker)
    if (cached) {
      result[ticker] = cached
    } else {
      toFetch.push(ticker)
    }
  }

  if (toFetch.length === 0) return result

  // Fetch from Edge Function (Yahoo Finance, no rate limits)
  try {
    const { data, error } = await supabase.functions.invoke('get-stock-overview', {
      body: { symbols: toFetch },
    })
    if (!error && data?.data) {
      for (const [ticker, info] of Object.entries(data.data)) {
        const entry = { pe: info.pe ?? null }
        setPECache(ticker, entry.pe)
        result[ticker] = entry
      }
    }
  } catch { /* fall through */ }

  return result
}

// ---------------------------------------------------------------------------
// Beta computed from price histories (works for stocks AND ETFs)
// ---------------------------------------------------------------------------

/**
 * Compute beta for a single ticker against SPY using overlapping daily log returns.
 * @param {Map} tickerMap  Map<'YYYY-MM-DD', price>
 * @param {Map} spyMap     Map<'YYYY-MM-DD', price>
 * @returns {number|null}
 */
function betaFromHistory(tickerMap, spyMap) {
  const dates = [...tickerMap.keys()].filter(d => spyMap.has(d)).sort()
  if (dates.length < 30) return null

  const tickerReturns = []
  const spyReturns = []
  for (let i = 1; i < dates.length; i++) {
    const tr = Math.log(tickerMap.get(dates[i]) / tickerMap.get(dates[i - 1]))
    const sr = Math.log(spyMap.get(dates[i]) / spyMap.get(dates[i - 1]))
    if (isFinite(tr) && isFinite(sr)) {
      tickerReturns.push(tr)
      spyReturns.push(sr)
    }
  }
  if (spyReturns.length < 30) return null

  const n = spyReturns.length
  const spyMean = spyReturns.reduce((s, r) => s + r, 0) / n
  const tMean = tickerReturns.reduce((s, r) => s + r, 0) / n
  const cov = spyReturns.reduce((s, r, i) => s + (r - spyMean) * (tickerReturns[i] - tMean), 0) / n
  const spyVar = spyReturns.reduce((s, r) => s + (r - spyMean) ** 2, 0) / n
  return spyVar > 0 ? cov / spyVar : null
}

/**
 * Weighted-average portfolio beta from individual ticker price histories vs SPY.
 * @param {Array} positions
 * @param {Object} prices       ticker → current price
 * @param {Object} histories    ticker → Map<date, price>
 * @param {Map}   spyMap        SPY Map<date, price>
 */
export function computeBeta(positions, prices, histories, spyMap) {
  let totalWeightedBeta = 0
  let totalWeight = 0

  for (const pos of positions) {
    const qty = calcQty(pos)
    if (qty <= 0) continue
    const price = prices[pos.ticker]
    if (!price) continue
    const tickerMap = histories?.[pos.ticker]
    if (!tickerMap?.size) continue

    const beta = betaFromHistory(tickerMap, spyMap)
    if (beta == null) continue

    const marketValue = qty * price
    totalWeightedBeta += marketValue * beta
    totalWeight += marketValue
  }

  return totalWeight > 0 ? totalWeightedBeta / totalWeight : null
}

// ---------------------------------------------------------------------------
// P/E
// ---------------------------------------------------------------------------

export function computePE(positions, prices, overviewData) {
  let totalWeightedPE = 0
  let totalWeight = 0

  for (const pos of positions) {
    if (pos.type === 'crypto') continue // crypto has no P/E
    const qty = calcQty(pos)
    if (qty <= 0) continue
    const price = prices[pos.ticker]
    if (!price) continue
    const ov = overviewData[pos.ticker]
    if (!ov?.pe || ov.pe <= 0 || ov.pe >= 500) continue

    const marketValue = qty * price
    totalWeightedPE += marketValue * ov.pe
    totalWeight += marketValue
  }

  return totalWeight > 0 ? totalWeightedPE / totalWeight : null
}

// ---------------------------------------------------------------------------
// TWR
// ---------------------------------------------------------------------------

export function computeTWR(positions, prices) {
  const allTrades = []
  for (const pos of positions) {
    for (const t of (pos.trades || [])) {
      allTrades.push({ ...t, ticker: pos.ticker })
    }
  }

  if (allTrades.length === 0) return { twr: null, annualizedReturn: null, startDate: null }

  allTrades.sort((a, b) => new Date(a.date) - new Date(b.date))
  const startDate = allTrades[0].date

  let totalNetInvested = 0
  for (const t of allTrades) {
    const amount = Number(t.quantity) * Number(t.price)
    if (t.type === 'buy') totalNetInvested += amount
    else totalNetInvested -= amount
  }

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
  const daysHeld = Math.max(1, (Date.now() - new Date(startDate + 'T00:00:00Z').getTime()) / (1000 * 60 * 60 * 24))
  const yearsHeld = daysHeld / 365
  const annualizedReturn = yearsHeld >= 0.1
    ? Math.pow(Math.max(0, 1 + twr), 1 / yearsHeld) - 1
    : twr

  return { twr, annualizedReturn, startDate }
}

// ---------------------------------------------------------------------------
// Sharpe / Sortino
// ---------------------------------------------------------------------------

export function computeSharpeSortino(annualizedReturn, beta, spyPrices, startDate) {
  if (!spyPrices?.length || !startDate || beta == null || beta <= 0) {
    return { sharpe: null, sortino: null, spySharpe: null, spySortino: null, spyAnnualReturn: null }
  }

  const startMs = new Date(startDate + 'T00:00:00Z').getTime()
  const filtered = spyPrices.filter(p => p.date >= startMs).sort((a, b) => a.date - b.date)
  if (filtered.length < 10) {
    return { sharpe: null, sortino: null, spySharpe: null, spySortino: null, spyAnnualReturn: null }
  }

  const returns = []
  for (let i = 1; i < filtered.length; i++) {
    returns.push(Math.log(filtered[i].price / filtered[i - 1].price))
  }

  const n = returns.length
  const mean = returns.reduce((s, r) => s + r, 0) / n
  const daysTotal = Math.max(1, (filtered[filtered.length - 1].date - filtered[0].date) / (1000 * 60 * 60 * 24))
  const spyAnnualReturn = Math.pow(filtered[filtered.length - 1].price / filtered[0].price, 365 / daysTotal) - 1

  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / n
  const spyAnnualVol = Math.sqrt(variance * 252)
  const negReturns = returns.filter(r => r < 0)
  const downVariance = negReturns.length > 0
    ? negReturns.reduce((s, r) => s + r ** 2, 0) / negReturns.length
    : variance
  const spyDownsideVol = Math.sqrt(downVariance * 252)

  const portfolioSigma = beta * spyAnnualVol
  const portfolioDownsideSigma = beta * spyDownsideVol

  const sharpe = portfolioSigma > 0 ? (annualizedReturn - RISK_FREE) / portfolioSigma : null
  const sortino = portfolioDownsideSigma > 0 ? (annualizedReturn - RISK_FREE) / portfolioDownsideSigma : null
  const spySharpe = spyAnnualVol > 0 ? (spyAnnualReturn - RISK_FREE) / spyAnnualVol : null
  const spySortino = spyDownsideVol > 0 ? (spyAnnualReturn - RISK_FREE) / spyDownsideVol : null

  return { sharpe, sortino, spySharpe, spySortino, spyAnnualReturn }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function calcQty(pos) {
  let buy = 0, sell = 0
  for (const t of (pos.trades || [])) {
    if (t.type === 'buy') buy += Number(t.quantity)
    else sell += Number(t.quantity)
  }
  return buy - sell
}
