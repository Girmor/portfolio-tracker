import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { supabase } from '../lib/supabase'
import { useTradeHistory } from '../hooks/useTradeHistory'
import { formatMoney, formatPercent } from '../lib/formatters'

const PERIODS = [
  { key: '7d', label: '7д', days: 7 },
  { key: '30d', label: '30д', days: 30 },
  { key: '90d', label: '90д', days: 90 },
  { key: 'all', label: 'Все', days: null },
]

function PortfolioHistoryChart({ portfolioId, positions, currentPrices = {}, budgetItems = [] }) {
  const [snapshots, setSnapshots] = useState([])
  const [snapLoading, setSnapLoading] = useState(false)
  const [period, setPeriod] = useState('all')
  const [mode, setMode] = useState('value')
  const [chartWidth, setChartWidth] = useState(0)
  const roRef = useRef(null)

  const containerRef = useCallback((el) => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null }
    if (!el) return
    const update = () => {
      const w = Math.floor(el.getBoundingClientRect().width)
      if (w > 0) setChartWidth(prev => prev === w ? prev : w)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    roRef.current = ro
  }, [])

  // Trade-based history (when positions prop is provided)
  const { points: tradePoints, loading: tradeLoading } = useTradeHistory(positions || [])

  // Snapshot-based history (legacy fallback — used on Overview or when no positions prop)
  useEffect(() => {
    if (positions) return
    setSnapLoading(true)
    supabase
      .from('snapshots')
      .select('created_at, data')
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        setSnapshots(data || [])
        setSnapLoading(false)
      })
  }, [positions])

  const snapshotPoints = useMemo(() => {
    if (positions) return []
    return snapshots
      .map(s => {
        const computed = s.data?.computed
        if (!computed) return null
        const pf = portfolioId ? computed.byPortfolio?.[portfolioId] : computed.overall
        if (!pf) return null
        const rawPct = pf.totalPnlPercent
        const pnlPercent = (rawPct == null || !isFinite(rawPct) || isNaN(rawPct)) ? 0 : rawPct
        return {
          date: new Date(s.created_at).getTime(),
          dateStr: new Date(s.created_at).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' }),
          value: pf.totalValue ?? 0,
          cost: pf.totalCost ?? 0,
          pnl: pf.totalPnl ?? 0,
          pnlPercent,
        }
      })
      .filter(Boolean)
  }, [snapshots, portfolioId, positions])

  const allPoints = positions ? tradePoints : snapshotPoints
  const loading = positions ? tradeLoading : snapLoading

  // Build month -> USD total map from all budget items (for history chart)
  const budgetByMonth = useMemo(() => {
    const map = new Map()
    for (const b of budgetItems) {
      const usd = b.currency === 'USD' ? Number(b.amount)
               : b.currency === 'EUR' ? Number(b.amount) * 1.08
               : Number(b.amount) / 41.5
      map.set(b.month, (map.get(b.month) || 0) + usd)
    }
    return map
  }, [budgetItems])

  const budgetMonthsSorted = useMemo(() => [...budgetByMonth.keys()].sort(), [budgetByMonth])

  const chartData = useMemo(() => {
    const periodObj = PERIODS.find(p => p.key === period)
    const filtered = !periodObj?.days
      ? allPoints
      : allPoints.filter(p => p.date >= Date.now() - periodObj.days * 24 * 60 * 60 * 1000)

    // Add budget to value when showing overview (portfolioId null) and budget exists
    if (portfolioId !== null || !budgetMonthsSorted.length) return filtered

    return filtered.map(p => {
      const pointMonth = new Date(p.date).toISOString().slice(0, 7)
      // find most recent budget month <= pointMonth
      let best = null
      for (const m of budgetMonthsSorted) {
        if (m <= pointMonth) best = m
        else break
      }
      const budgetUsd = best ? (budgetByMonth.get(best) || 0) : 0
      return { ...p, value: p.value + budgetUsd }
    })
  }, [allPoints, period, portfolioId, budgetByMonth, budgetMonthsSorted])

  // Compute smart X-axis ticks based on visible data range
  const { xTicks, xFormatter } = useMemo(() => {
    if (!chartData.length) return { xTicks: [], xFormatter: (v) => v }
    const n = chartData.length

    let stepDays
    let fmt
    if (n > 180) {
      stepDays = 30
      fmt = (ts) => new Date(ts).toLocaleDateString('uk-UA', { month: 'short', year: '2-digit' })
    } else if (n > 60) {
      stepDays = 14
      fmt = (ts) => new Date(ts).toLocaleDateString('uk-UA', { day: '2-digit', month: 'short' })
    } else if (n > 14) {
      stepDays = 7
      fmt = (ts) => new Date(ts).toLocaleDateString('uk-UA', { day: '2-digit', month: 'short' })
    } else {
      stepDays = 1
      fmt = (ts) => new Date(ts).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' })
    }

    const MS = stepDays * 24 * 60 * 60 * 1000
    const ticks = []
    let lastTick = -Infinity
    for (const p of chartData) {
      if (p.date - lastTick >= MS) {
        ticks.push(p.date)
        lastTick = p.date
      }
    }
    return { xTicks: ticks, xFormatter: fmt }
  }, [chartData])

  const dataKey = mode === 'value' ? 'value' : 'pnlPercent'
  const formatter = mode === 'value'
    ? (v) => (v == null || !isFinite(v)) ? '—' : formatMoney(v)
    : (v) => (v == null || !isFinite(v)) ? '—' : formatPercent(v)
  const gradientId = `histGrad-${portfolioId || 'all'}`

  const tooltipStyle = {
    background: '#1e293b',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8,
    color: '#e2e8f0',
  }

  const emptyMessage = positions
    ? 'Недостатньо даних. Додайте угоди щоб побачити графік.'
    : 'Недостатньо даних для графіка. Дані накопичуються з щоденних снепшотів.'

  return (
    <div className="glass-card rounded-xl p-5 mb-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="text-sm font-semibold text-slate-200">{portfolioId === null ? 'Історія капіталу' : 'Історія портфеля'}</h3>
        <div className="flex flex-wrap items-center gap-2">
          {/* Mode toggle */}
          <div className="flex bg-white/8 rounded-lg p-0.5">
            <button
              onClick={() => setMode('value')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                mode === 'value' ? 'bg-white/15 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Капітал ($)
            </button>
            <button
              onClick={() => setMode('profit')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                mode === 'profit' ? 'bg-white/15 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Прибуток (%)
            </button>
          </div>

          {/* Period selector */}
          <div className="flex bg-white/8 rounded-lg p-0.5">
            {PERIODS.map(p => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  period === p.key ? 'bg-white/15 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart */}
      {loading ? (
        <div className="flex items-center justify-center h-[250px] text-slate-400 text-sm">
          Завантаження...
        </div>
      ) : chartData.length < 2 ? (
        <div className="flex items-center justify-center h-[250px] text-slate-400 text-sm text-center px-4">
          {emptyMessage}
        </div>
      ) : (
        <div ref={containerRef} style={{ height: 250, overflow: 'hidden' }}>
          {chartWidth > 0 && (
            <AreaChart width={chartWidth} height={250} data={chartData}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(59,130,246,0.35)" />
                  <stop offset="100%" stopColor="rgba(59,130,246,0)" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" />
              <XAxis
                dataKey="date"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                ticks={xTicks}
                tickFormatter={xFormatter}
                tick={{ fontSize: 11, fill: '#94a3b8' }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                tickFormatter={mode === 'value'
                  ? (v) => (v == null || !isFinite(v)) ? '' : `$${(v / 1000).toFixed(0)}k`
                  : (v) => (v == null || !isFinite(v)) ? '' : `${v.toFixed(0)}%`
                }
              />
              <Tooltip
                formatter={(v) => [formatter(v), mode === 'value' ? 'Капітал' : 'Прибуток']}
                labelFormatter={(ts) => new Date(ts).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                contentStyle={tooltipStyle}
              />
              <Area
                type="monotone"
                dataKey={dataKey}
                stroke="#60a5fa"
                fill={`url(#${gradientId})`}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                activeDot={{ r: 4, fill: '#60a5fa', stroke: '#1e293b', strokeWidth: 2 }}
              />
            </AreaChart>
          )}
        </div>
      )}
    </div>
  )
}

export default memo(PortfolioHistoryChart)
