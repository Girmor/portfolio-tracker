import { useState, useEffect, useMemo } from 'react'
import { AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { supabase } from '../lib/supabase'
import { getBtcHistoricalPrices } from '../lib/priceService'
import { formatMoney, formatPercent } from '../lib/formatters'

const PERIODS = [
  { key: '7d', label: '7д', days: 7 },
  { key: '30d', label: '30д', days: 30 },
  { key: '90d', label: '90д', days: 90 },
  { key: 'all', label: 'Все', days: null },
]

export default function PortfolioHistoryChart({ portfolioId }) {
  const [snapshots, setSnapshots] = useState([])
  const [btcRaw, setBtcRaw] = useState([])
  const [period, setPeriod] = useState('all')
  const [mode, setMode] = useState('value')
  const [showBtc, setShowBtc] = useState(false)
  const [loading, setLoading] = useState(true)
  const [btcLoading, setBtcLoading] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('snapshots')
        .select('created_at, data')
        .order('created_at', { ascending: true })
      setSnapshots(data || [])
      setLoading(false)
    }
    load()
  }, [])

  useEffect(() => {
    if (!showBtc || btcRaw.length > 0) return
    async function loadBtc() {
      setBtcLoading(true)
      const data = await getBtcHistoricalPrices(365)
      setBtcRaw(data)
      setBtcLoading(false)
    }
    loadBtc()
  }, [showBtc])

  const allPoints = useMemo(() => {
    return snapshots
      .map(s => {
        const computed = s.data?.computed
        if (!computed) return null
        const pf = portfolioId
          ? computed.byPortfolio?.[portfolioId]
          : computed.overall
        if (!pf) return null
        return {
          date: new Date(s.created_at).getTime(),
          dateStr: new Date(s.created_at).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' }),
          value: pf.totalValue,
          cost: pf.totalCost,
          pnl: pf.totalPnl,
          pnlPercent: pf.totalPnlPercent,
        }
      })
      .filter(Boolean)
  }, [snapshots, portfolioId])

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
    return chartData.map(d => {
      const day = new Date(d.date).toISOString().split('T')[0]
      return { ...d, btcPercent: btcByDay.get(day) ?? null }
    })
  }, [chartData, btcRaw, showBtc, mode])

  const dataKey = mode === 'value' ? 'value' : 'pnlPercent'
  const formatter = mode === 'value' ? (v) => formatMoney(v) : (v) => formatPercent(v)
  const areaColor = mode === 'value' ? '#3B82F6' : '#10B981'
  const gradientId = `histGrad-${portfolioId || 'all'}`

  const tooltipStyle = {
    background: '#1e293b',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8,
    color: '#e2e8f0',
  }

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
          Недостатньо даних для графіка. Дані накопичуються з щоденних снепшотів.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={mergedData}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={areaColor} stopOpacity={0.20} />
                <stop offset="95%" stopColor={areaColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" />
            <XAxis dataKey="dateStr" tick={{ fontSize: 11, fill: '#94a3b8' }} />
            <YAxis
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              tickFormatter={mode === 'value' ? (v) => `$${(v / 1000).toFixed(0)}k` : (v) => `${v.toFixed(0)}%`}
            />
            <Tooltip
              formatter={(v, name) => [
                name === 'btcPercent' ? formatPercent(v) : formatter(v),
                name === 'btcPercent' ? 'BTC' : (mode === 'value' ? 'Капітал' : 'Прибуток'),
              ]}
              labelFormatter={(label) => label}
              contentStyle={tooltipStyle}
            />
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={areaColor}
              fill={`url(#${gradientId})`}
              strokeWidth={2}
              dot={false}
            />
            {showBtc && mode === 'profit' && (
              <Line
                type="monotone"
                dataKey="btcPercent"
                stroke="#F59E0B"
                strokeWidth={1.5}
                dot={false}
                strokeDasharray="4 4"
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      )}

      {/* Legend for BTC */}
      {showBtc && mode === 'profit' && mergedData.length >= 2 && (
        <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-0.5 bg-green-500 rounded" />
            <span>Портфель</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-0.5 bg-orange-400 rounded" style={{ borderTop: '1px dashed #F59E0B' }} />
            <span>BTC</span>
          </div>
        </div>
      )}
    </div>
  )
}
