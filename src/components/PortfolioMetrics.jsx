import { useState, useEffect, useRef } from 'react'
import { getSpxHistoricalPrices } from '../lib/priceService'
import {
  fetchOverview,
  computePE,
  computeBeta,
  computeTWR,
  computeSharpeSortino,
} from '../lib/portfolioMetrics'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtUk(n, decimals = 2) {
  if (n == null || !isFinite(n)) return '—'
  return Number(n).toFixed(decimals).replace('.', ',')
}

function fmtPct(n) {
  if (n == null || !isFinite(n)) return '—'
  const sign = n >= 0 ? '+' : ''
  return sign + fmtUk(n * 100) + '%'
}

// ---------------------------------------------------------------------------
// MetricScale — gradient bar with one or two marker dots
// ---------------------------------------------------------------------------

function MetricScale({ min, max, value, benchmarkValue, label, benchmarkLabel }) {
  const clamp = (v) => Math.min(max, Math.max(min, v))
  const pct = (v) => ((clamp(v) - min) / (max - min)) * 100

  const valuePct = value != null ? pct(value) : null
  const benchPct = benchmarkValue != null ? pct(benchmarkValue) : null

  return (
    <div className="mt-3">
      <div className="relative h-2 rounded-full bg-gradient-to-r from-slate-700 via-slate-500 to-slate-700">
        {valuePct != null && (
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-blue-400 border-2 border-slate-900 shadow"
            style={{ left: `calc(${valuePct}% - 6px)` }}
          />
        )}
        {benchPct != null && (
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-slate-300 border-2 border-slate-900 shadow"
            style={{ left: `calc(${benchPct}% - 6px)` }}
          />
        )}
      </div>
      <div className="relative flex justify-between mt-2 text-xs text-slate-500">
        <span>{min}</span>
        <span>{max}</span>
      </div>
      {(label || benchmarkLabel) && (
        <div className="flex gap-4 mt-1 text-xs">
          {label && valuePct != null && (
            <span className="flex items-center gap-1 text-blue-400">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-400" />
              {label}
            </span>
          )}
          {benchmarkLabel && benchPct != null && (
            <span className="flex items-center gap-1 text-slate-400">
              <span className="inline-block w-2 h-2 rounded-full bg-slate-400" />
              {benchmarkLabel}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// MetricCard — glass card with title, optional tooltip, loading skeleton
// ---------------------------------------------------------------------------

function MetricCard({ title, subtitle, tooltipText, loading, children }) {
  const [showTooltip, setShowTooltip] = useState(false)
  const tooltipRef = useRef(null)

  useEffect(() => {
    if (!showTooltip) return
    function handleClick(e) {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target)) {
        setShowTooltip(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showTooltip])

  return (
    <div className="glass-card rounded-xl p-5 relative">
      <div className="flex items-start justify-between mb-1">
        <div>
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">{title}</div>
          {subtitle && <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>}
        </div>
        {tooltipText && (
          <div className="relative" ref={tooltipRef}>
            <button
              onClick={() => setShowTooltip(v => !v)}
              className="w-5 h-5 rounded-full border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-400 text-xs flex items-center justify-center transition-colors"
              aria-label="Деталі"
            >
              ?
            </button>
            {showTooltip && (
              <div className="absolute right-0 top-7 z-50 w-72 glass-card rounded-xl p-3 text-xs text-slate-300 leading-relaxed shadow-xl">
                {tooltipText}
              </div>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="animate-pulse mt-3">
          <div className="h-7 bg-white/10 rounded w-1/2 mb-2" />
          <div className="h-3 bg-white/10 rounded w-3/4" />
        </div>
      ) : children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PortfolioMetrics — main component
// ---------------------------------------------------------------------------

export default function PortfolioMetrics({ positions, prices }) {
  const [loading, setLoading] = useState(true)
  const [metrics, setMetrics] = useState(null)

  useEffect(() => {
    if (!positions?.length) {
      setLoading(false)
      return
    }

    let cancelled = false

    async function load() {
      setLoading(true)

      // 1. Fetch Alpha Vantage OVERVIEW for each unique stock ticker
      const stockTickers = [...new Set(
        positions
          .filter(p => p.type === 'stock')
          .map(p => p.ticker)
      )]

      const [overviewResults, spyResult] = await Promise.allSettled([
        Promise.allSettled(stockTickers.map(t => fetchOverview(t).then(v => [t, v]))),
        getSpxHistoricalPrices(),
      ])

      if (cancelled) return

      const overviewData = {}
      if (overviewResults.status === 'fulfilled') {
        for (const r of overviewResults.value) {
          if (r.status === 'fulfilled' && r.value) {
            const [ticker, data] = r.value
            if (data) overviewData[ticker] = data
          }
        }
      }

      const spyPrices = spyResult.status === 'fulfilled' ? spyResult.value : []

      // 2. Compute metrics
      const pe = computePE(positions, prices, overviewData)
      const beta = computeBeta(positions, prices, overviewData)
      const { twr, annualizedReturn, startDate } = computeTWR(positions, prices)

      // 3. Compute SPY period return for comparison
      let spyPeriodReturn = null
      if (spyPrices.length && startDate) {
        const startMs = new Date(startDate + 'T00:00:00Z').getTime()
        const filtered = spyPrices.filter(p => p.date >= startMs).sort((a, b) => a.date - b.date)
        if (filtered.length >= 2) {
          spyPeriodReturn = (filtered[filtered.length - 1].price - filtered[0].price) / filtered[0].price
        }
      }

      const { sharpe, sortino, spySharpe, spySortino, spyAnnualReturn } =
        computeSharpeSortino(annualizedReturn, beta, spyPrices, startDate)

      if (!cancelled) {
        setMetrics({ pe, beta, twr, annualizedReturn, startDate, spyPeriodReturn, sharpe, sortino, spySharpe, spySortino, spyAnnualReturn })
        setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [positions, prices]) // eslint-disable-line react-hooks/exhaustive-deps

  const noData = <span className="text-slate-500 text-sm">Недостатньо даних</span>

  function betaStatus(beta) {
    if (beta == null) return null
    if (beta < 0.8) return 'нижча за ринок'
    if (beta <= 1.2) return 'на рівні ринку'
    return 'вища за ринок'
  }

  function sharpeEmoji(v) {
    if (v == null) return ''
    if (v < 1) return '😕'
    if (v <= 2) return '😐'
    return '😊'
  }

  function sharpeStatus(v) {
    if (v == null) return null
    if (v < 1) return 'потребує уваги'
    if (v <= 2) return 'нормально'
    return 'добре'
  }

  const m = metrics

  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold text-white mb-4">Метрики</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* TWR */}
        <MetricCard
          title="Дохідність портфеля (TWR)"
          subtitle="Від першої угоди"
          tooltipText="Time-Weighted Return — дохідність портфеля від дати першої угоди. Розраховується як (поточна вартість − вкладено) / вкладено. Зіставляється з дохідністю S&P 500 за той самий період."
          loading={loading}
        >
          {m?.twr != null ? (
            <div>
              <div className={`text-3xl font-bold mt-2 ${m.twr >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {fmtUk(m.twr * 100)}%
              </div>
              {m.spyPeriodReturn != null && (
                <div className="text-xs text-slate-400 mt-1">
                  S&P 500: {fmtUk(m.spyPeriodReturn * 100)}%
                  {' '}
                  <span className={m.twr >= m.spyPeriodReturn ? 'text-emerald-400' : 'text-red-400'}>
                    ({m.twr >= m.spyPeriodReturn ? '▲' : '▼'} {fmtUk(Math.abs((m.twr - m.spyPeriodReturn) * 100))}%)
                  </span>
                </div>
              )}
            </div>
          ) : noData}
        </MetricCard>

        {/* P/E */}
        <MetricCard
          title="P/E (Ціна / Прибуток)"
          subtitle="Зважений по ринковій вартості"
          tooltipText="Price-to-Earnings — відношення ціни акції до прибутку на акцію. Зважений середній по всіх акціях портфеля. Низький P/E може означати недооцінену компанію, високий — переоціненість або швидке зростання. Крипто не враховується."
          loading={loading}
        >
          {m?.pe != null ? (
            <div>
              <div className="text-3xl font-bold text-white mt-2">{fmtUk(m.pe, 1)}x</div>
              <MetricScale min={0} max={70} value={m.pe} label="Портфель" />
            </div>
          ) : noData}
        </MetricCard>

        {/* Beta */}
        <MetricCard
          title="Бета (β)"
          subtitle="Чутливість до ринку"
          tooltipText="Бета показує, наскільки ваш портфель рухається відносно ринку (S&P 500). β = 1 — повторює ринок, β < 1 — менш волатильний, β > 1 — більш волатильний. Розраховується як зважена середня бета акцій. Крипто не враховується."
          loading={loading}
        >
          {m?.beta != null ? (
            <div>
              <div className="text-sm text-slate-300 mt-2">
                ⚡ Волатильність вашого портфеля (β = {fmtUk(m.beta)}) {betaStatus(m.beta)}
              </div>
              <MetricScale
                min={0} max={2}
                value={m.beta}
                benchmarkValue={1}
                label="Портфель"
                benchmarkLabel="Ринок"
              />
            </div>
          ) : noData}
        </MetricCard>

        {/* Sharpe */}
        <MetricCard
          title="Коефіцієнт Шарпа"
          subtitle="Дохідність з урахуванням ризику"
          tooltipText="Коефіцієнт Шарпа = (дохідність − безризикова ставка) / волатильність. Показує, скільки дохідності ви отримуєте за одиницю ризику. > 1 — добре, > 2 — відмінно. Безризикова ставка: 4,3% (5-річні держоблігації США). Волатильність = β × волатильність S&P 500."
          loading={loading}
        >
          {m?.sharpe != null ? (
            <div>
              <div className="text-sm text-slate-300 mt-2">
                {sharpeEmoji(m.sharpe)} Дохідність з урахуванням ризику (к. Шарпа = {fmtUk(m.sharpe)}) {sharpeStatus(m.sharpe)}
              </div>
              <MetricScale
                min={-1} max={3}
                value={m.sharpe}
                benchmarkValue={m.spySharpe}
                label="Портфель"
                benchmarkLabel="S&P 500"
              />
            </div>
          ) : noData}
        </MetricCard>

        {/* Sortino */}
        <MetricCard
          title="Коефіцієнт Сортіно"
          subtitle="Дохідність відносно низхідного ризику"
          tooltipText="Коефіцієнт Сортіно схожий на Шарпа, але враховує лише негативну волатильність (просадки). Це кращий показник для активів зі значними зростаннями. Коефіцієнт понад 2 вважається хорошим. Безризикова ставка: 4,3%."
          loading={loading}
        >
          {m?.sortino != null ? (
            <div>
              <div className="text-sm text-slate-300 mt-2">
                {sharpeEmoji(m.sortino)} Коефіцієнт Сортіно вашого портфеля ({fmtUk(m.sortino)}) {sharpeStatus(m.sortino)}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Коефіцієнт Сортіно понад 2 вважається хорошим показником
              </div>
              <MetricScale
                min={-1} max={3}
                value={m.sortino}
                benchmarkValue={m.spySortino}
                label="Портфель"
                benchmarkLabel="S&P 500"
              />
            </div>
          ) : noData}
        </MetricCard>

      </div>
    </div>
  )
}
