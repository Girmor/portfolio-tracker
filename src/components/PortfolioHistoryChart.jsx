import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react'
import { AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { supabase } from '../lib/supabase'
import { getBtcHistoricalPrices } from '../lib/priceService'
import { useTradeHistory } from '../hooks/useTradeHistory'
import { formatMoney, formatPercent } from '../lib/formatters'

const PERIODS = [
  { key: '7d', label: '7д', days: 7 },
  { key: '30d', label: '30д', days: 30 },
  { key: '90d', label: '90д', days: 90 },
  { key: 'all', label: 'Все', days: null },
]

function PortfolioHistoryChart({ portfolioId, positions, currentPrices = {} }) {
  const [snapshots, setSnapshots] = useState([])
  const [snapLoading, setSnapLoading] = useState(false)
  const [btcRaw, setBtcRaw] = useState([])
  const [period, setPeriod] = useState('all')
  const [mode, setMode] = useState('value')
  const [showBtc, setShowBtc] = useState(false)
  const [btcLoading, setBtcLoading] = useState(false)
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

  // BTC comparison overlay
  useEffect(() => {
    if (!showBtc || btcRaw.length > 0) return
    async function loadBtc() {
      setBtcLoading(true)
      const data = await getBtcHistoricalPrices(365)
      setBtcRaw(data)
      setBtcLoading(false)
    }
    loadBtc()
  }, [showBtc, btcRaw.length])

  const chartData = useMemo(() => {
    const periodObj = PERIODS.find(p => p.key === period)
    if (!periodObj?.days) return allPoints
    const since = Date.now() - periodObj.days * 24 * 60 * 60 * 1000
    return allPoints.filter(p => p.date >= since)
  }, [allPoints, period])

  const mergedData = useMemo(() => {
    if (!showBtc || mode !== 'profit' || !btcRaw.length || !chartData.length) return chartData
    const chartStart = chartData[0].date
    let btcStartPrice = null
    for (const p of btcRaw) {
      if (p.date >= chartStart - 24 * 60 * 60 * 1000) {
        btcStartPrice = p.price
        break
      }
    }
    if (!btcStartPrice) btcStartPrice = btcRaw[0]?.price || 1
    const btcByDay = new Map()
    btcRaw.forEach(p => {
      const day = new Date(p.date).toISOString().split('T')[0]
      btcByDay.set(day, ((p.price - btcStartPrice) / btcStartPrice) * 100)
    })
    return chartData.map(d => ({
      ...d,
      btcPercent: btcByDay.get(new Date(d.date).toISOString().split('T')[0]) ?? null,
    }))
  }, [chartData, btcRaw, showBtc, mode])

  // Compute smart X-axis ticks based on visible data range
  const { xTicks, xFormatter } = useMemo(() => {
    if (!mergedData.length) return { xTicks: [], xFormatter: (v) => v }
    const n = mergedData.length

    // Pick tick density based on number of points
    let stepDays
    let fmt
    if (n > 180) {
      stepDays = 30  // ~monthly
      fmt = (ts) => new Date(ts).toLocaleDateString('uk-UA', { month: 'short', year: '2-digit' })
    } else if (n > 60) {
      stepDays = 14  // bi-weekly
      fmt = (ts) => new Date(ts).toLocaleDateString('uk-UA', { day: '2-digit', month: 'short' })
    } else if (n > 14) {
      stepDays = 7   // weekly
      fmt = (ts) => new Date(ts).toLocaleDateString('uk-UA', { day: '2-digit', month: 'short' })
    } else {
      stepDays = 1
      fmt = (ts) => new Date(ts).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' })
    }

    const MS = stepDays * 24 * 60 * 60 * 1000
    const ticks = []
    let lastTick = -Infinity
    for (const p of mergedData) {
      if (p.date - lastTick >= MS) {
        ticks.push(p.date)
        lastTick = p.date
      }
    }
    return { xTicks: ticks, xFormatter: fmt }
  }, [mergedData])

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
        <h3 className="text-sm font-semibold text-slate-200">Історія портфеля</h3>
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

          {/* BTC toggle */}
          <button
            onClick={() => mode === 'profit' && setShowBtc(!showBtc)}
            className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
              mode !== 'profit'
                ? 'border-white/8 text-slate-600 cursor-not-allowed'
                : showBtc
                  ? 'border-orange-400/40 bg-orange-500/15 text-orange-400'
                  : 'border-white/12 text-slate-400 hover:bg-white/5'
            }`}
            title={mode !== 'profit' ? 'Порівняння з BTC доступне лише в режимі Прибуток (%)' : ''}
          >
            vs BTC
          </button>

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
      {loading || btcLoading ? (
        <div className="flex items-center justify-center h-[250px] text-slate-400 text-sm">
          Завантаження...
        </div>
      ) : mergedData.length < 2 ? (
        <div className="flex items-center justify-center h-[250px] text-slate-400 text-sm text-center px-4">
          {emptyMessage}
        </div>
      ) : (
        <div ref={containerRef} style={{ height: 250, overflow: 'hidden' }}>
          {chartWidth > 0 && (
            <AreaChart width={chartWidth} height={250} data={mergedData}>
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
                formatter={(v, name) => [
                  name === 'btcPercent' ? formatPercent(v) : formatter(v),
                  name === 'btcPercent' ? 'BTC' : (mode === 'value' ? 'Капітал' : 'Прибуток'),
                ]}
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
              {showBtc && mode === 'profit' && (
                <Line
                  type="monotone"
                  dataKey="btcPercent"
                  stroke="#f59e0b"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                  strokeDasharray="4 3"
                />
              )}
            </AreaChart>
          )}
        </div>
      )}

      {/* Legend for BTC */}
      {showBtc && mode === 'profit' && mergedData.length >= 2 && (
        <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-0.5 bg-blue-400 rounded" />
            <span>Портфель</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-0.5 bg-orange-400 rounded" />
            <span>BTC</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(PortfolioHistoryChart)
