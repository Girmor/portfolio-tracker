import { useState, useMemo, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
} from '@tanstack/react-table'
import { formatMoney, formatDate } from '../lib/formatters'
import { useDividendsQuery, useCreateDividendMutation, useDeleteDividendMutation } from '../hooks/useDividendsQuery'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList,
  ResponsiveContainer, Cell,
} from 'recharts'
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ChevronsUpDown, Plus, Trash2 } from 'lucide-react'
import { buildForecast } from '../lib/dividendForecast'
import { fetchDividendHistory } from '../lib/priceService'

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16']
const MONTHS = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру']
const MONTHS_FULL = [
  'Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
  'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень',
]

const schema = z.object({
  ticker: z.string().min(1, "Тікер обов'язковий"),
  amount: z.coerce.number().positive('Сума має бути > 0'),
  date: z.string().optional(),
  notes: z.string().optional(),
})

const tooltipStyle = {
  background: '#1e293b',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 8,
  color: '#e2e8f0',
}

function ForecastTab({ dividends }) {
  const [finnhubMeta, setFinnhubMeta] = useState({})
  const [finnhubLoading, setFinnhubLoading] = useState(false)
  const fetchedRef = useRef(new Set())

  // Unique stock tickers (skip crypto — no dividends on Finnhub)
  const tickers = useMemo(() => [...new Set(dividends.map(d => d.ticker))], [dividends])

  useEffect(() => {
    const missing = tickers.filter(t => !fetchedRef.current.has(t))
    if (missing.length === 0) return
    setFinnhubLoading(true)
    missing.forEach(t => fetchedRef.current.add(t))
    Promise.allSettled(missing.map(t => fetchDividendHistory(t).then(data => ({ t, data }))))
      .then(results => {
        const updates = {}
        results.forEach(r => {
          if (r.status === 'fulfilled' && r.value.data) updates[r.value.t] = r.value.data
        })
        setFinnhubMeta(prev => ({ ...prev, ...updates }))
        setFinnhubLoading(false)
      })
  }, [tickers])

  const forecast = useMemo(() => buildForecast(dividends, finnhubMeta), [dividends, finnhubMeta])
  const { trailing12M, forward12M, monthlyRunRate, growthPct, series, perTicker } = forecast

  if (dividends.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400">
        <p className="text-lg">Додайте дивідендні виплати для побудови прогнозу</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {finnhubLoading && (
        <div className="text-xs text-slate-500 flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-full border-2 border-slate-500 border-t-indigo-400 animate-spin" />
          Завантаження даних з Finnhub…
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-card rounded-xl p-5">
          <div className="text-sm text-slate-400 mb-1">Прогноз (12 місяців)</div>
          <div className="text-2xl font-bold text-indigo-400">{formatMoney(forward12M)} / рік</div>
          <div className="text-sm text-slate-400 mt-1">{formatMoney(monthlyRunRate)} / місяць</div>
        </div>
        <div className="glass-card rounded-xl p-5">
          <div className="text-sm text-slate-400 mb-1">Trailing 12M (факт)</div>
          <div className="text-2xl font-bold text-green-400">{formatMoney(trailing12M)}</div>
          <div className="text-sm text-slate-500 mt-1">отримано за останній рік</div>
        </div>
        <div className="glass-card rounded-xl p-5">
          <div className="text-sm text-slate-400 mb-1">YoY ріст</div>
          {growthPct !== null ? (
            <div className={`text-2xl font-bold ${growthPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {growthPct >= 0 ? '▲' : '▼'} {Math.abs(growthPct).toFixed(1)}%
            </div>
          ) : (
            <div className="text-2xl font-bold text-slate-500">—</div>
          )}
          <div className="text-sm text-slate-500 mt-1">прогноз vs факт</div>
        </div>
      </div>

      {/* Combined 24-month chart */}
      <div className="glass-card rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-200 mb-4">Дивіденди: факт + прогноз (24 місяці)</h3>
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series} margin={{ top: 20, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.07)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} interval={1} />
              <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} tickFormatter={v => `$${v}`} />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                contentStyle={tooltipStyle}
                formatter={(value, name) => [formatMoney(value), name]}
                labelFormatter={label => label}
              />
              <Legend
                formatter={value => <span style={{ color: '#cbd5e1', fontSize: 12 }}>{value}</span>}
              />
              <Bar dataKey="actual" name="Факт" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={36}>
                <LabelList dataKey="actual" position="top" formatter={v => v > 0 ? `$${Math.round(v)}` : ''} style={{ fill: '#94a3b8', fontSize: 11 }} />
              </Bar>
              <Bar dataKey="forecast" name="Прогноз" fill="#818cf8" opacity={0.75} radius={[3, 3, 0, 0]} maxBarSize={36}>
                <LabelList dataKey="forecast" position="top" formatter={v => v > 0 ? `$${Math.round(v)}` : ''} style={{ fill: '#94a3b8', fontSize: 11 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xs text-slate-500 mt-3">
          Прогноз є оцінкою на основі історичних виплат. Майбутні дивіденди не гарантовані.
        </p>
      </div>

      {/* Per-ticker + Growth chart side by side */}
      {(() => {
        // Build last-3-years growth data
        const currentYear = new Date().getFullYear()
        const years = [currentYear - 2, currentYear - 1, currentYear]
        const YEAR_COLORS = { [years[0]]: '#F59E0B', [years[1]]: '#22d3ee', [years[2]]: '#a78bfa' }

        const growthData = MONTHS.map((name, mi) => {
          const row = { name }
          years.forEach(y => {
            row[y] = dividends
              .filter(d => new Date(d.date).getFullYear() === y && new Date(d.date).getMonth() === mi)
              .reduce((s, d) => s + Number(d.amount), 0)
          })
          return row
        })

        return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Per-ticker breakdown */}
            <div className="glass-card rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    <th className="py-3 px-4 text-left font-medium text-slate-400">Тікер</th>
                    <th className="py-3 px-4 text-left font-medium text-slate-400">Частота</th>
                    <th className="py-3 px-4 text-right font-medium text-slate-400">Середня виплата</th>
                    <th className="py-3 px-4 text-right font-medium text-slate-400">Прогноз / рік</th>
                    <th className="py-3 px-4 text-right font-medium text-slate-400">Ріст DPS</th>
                    <th className="py-3 px-4 text-right font-medium text-slate-400">%</th>
                  </tr>
                </thead>
                <tbody>
                  {perTicker.map(t => {
                    const annual = t.forecastEvents.reduce((s, e) => s + e.amount, 0)
                    const pct = forward12M > 0 ? (annual / forward12M * 100).toFixed(1) : '0'
                    const dps = t.dpsGrowth?.growthPct
                    return (
                      <tr key={t.ticker} className="border-b border-white/[0.06] hover:bg-white/5">
                        <td className="py-3 px-4 font-medium text-white">{t.ticker}</td>
                        <td className="py-3 px-4">
                          <span className="text-slate-300">{t.freqLabel}</span>
                          {t.freqSource === 'finnhub' && (
                            <span className="ml-1.5 text-[10px] text-indigo-400 bg-indigo-400/10 px-1.5 py-0.5 rounded">Finnhub</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-300">
                          {t.frequency === 'unknown' ? '—' : formatMoney(t.avgPayment)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {t.frequency === 'unknown'
                            ? <span className="text-slate-500">Недостатньо даних</span>
                            : <span className="text-indigo-400 font-medium">{formatMoney(annual)}</span>
                          }
                        </td>
                        <td className="py-3 px-4 text-right">
                          {dps === null || dps === undefined
                            ? <span className="text-slate-500">—</span>
                            : <span className={dps >= 0 ? 'text-green-400' : 'text-red-400'}>
                                {dps >= 0 ? '▲' : '▼'} {Math.abs(dps).toFixed(1)}%
                              </span>
                          }
                        </td>
                        <td className="py-3 px-4 text-right text-slate-400">
                          {t.frequency === 'unknown' ? '—' : `${pct}%`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Year-over-year growth chart */}
            <div className="glass-card rounded-xl p-5">
              <h3 className="text-sm font-semibold text-slate-200 mb-4">Ріст дивідендів</h3>
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={growthData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.07)" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={v => `$${v}`} />
                    <Tooltip
                      cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                      contentStyle={tooltipStyle}
                      formatter={(value, name) => [`${formatMoney(value)}`, name]}
                      labelFormatter={label => <span style={{ fontWeight: 600 }}>{label}</span>}
                    />
                    <Legend formatter={value => <span style={{ color: '#cbd5e1', fontSize: 12 }}>{value}</span>} />
                    {years.map(y => (
                      <Bar key={y} dataKey={y} name={String(y)} fill={YEAR_COLORS[y]} radius={[3, 3, 0, 0]} maxBarSize={20} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

export default function Dividends() {
  const [showForm, setShowForm] = useState(false)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [sorting, setSorting] = useState([{ id: 'date', desc: true }])
  const [activeTab, setActiveTab] = useState('history')

  const { data: dividends = [], isLoading } = useDividendsQuery()
  const createDividend = useCreateDividendMutation()
  const deleteDividend = useDeleteDividendMutation()

  const { register, handleSubmit, reset, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { ticker: '', amount: '', date: '', notes: '' },
  })

  async function onSubmit(values) {
    try {
      await createDividend.mutateAsync({
        ticker: values.ticker.toUpperCase(),
        amount: values.amount,
        date: values.date || new Date().toISOString().split('T')[0],
        notes: values.notes || null,
      })
      reset()
      setShowForm(false)
      toast.success('Дохід додано')
    } catch (err) {
      toast.error(err.message)
    }
  }

  async function handleDelete(id) {
    if (!confirm('Видалити цей запис?')) return
    try {
      await deleteDividend.mutateAsync(id)
      toast.success('Запис видалено')
    } catch (err) {
      toast.error(err.message)
    }
  }

  const total = dividends.reduce((sum, d) => sum + Number(d.amount), 0)

  const availableYears = useMemo(() => {
    const years = new Set(dividends.map(d => new Date(d.date).getFullYear()))
    if (years.size === 0) years.add(new Date().getFullYear())
    return [...years].sort((a, b) => b - a)
  }, [dividends])

  useEffect(() => {
    if (availableYears.length === 0) return
    if (!availableYears.includes(selectedYear)) {
      setSelectedYear(availableYears[0])
    }
  }, [availableYears])

  const yearDividends = useMemo(
    () => dividends.filter(d => new Date(d.date).getFullYear() === selectedYear),
    [dividends, selectedYear],
  )

  const yearTotal = yearDividends.reduce((sum, d) => sum + Number(d.amount), 0)

  const monthlyData = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, i) => ({
      name: MONTHS[i],
      fullName: MONTHS_FULL[i],
      amount: 0,
    }))
    yearDividends.forEach(d => {
      const month = new Date(d.date).getMonth()
      months[month].amount += Number(d.amount)
    })
    return months.map(m => ({ ...m, amount: Math.round(m.amount * 100) / 100 }))
  }, [yearDividends])

  const monthsWithData = monthlyData.filter(m => m.amount > 0).length
  const avgPerMonth = monthsWithData > 0 ? yearTotal / monthsWithData : 0

  const tickerData = useMemo(() => {
    const map = {}
    yearDividends.forEach(d => {
      map[d.ticker] = (map[d.ticker] || 0) + Number(d.amount)
    })
    return Object.entries(map)
      .map(([ticker, amount]) => ({
        ticker,
        amount: Math.round(amount * 100) / 100,
        percent: yearTotal > 0 ? ((amount / yearTotal) * 100).toFixed(1) : '0',
      }))
      .sort((a, b) => b.amount - a.amount)
  }, [yearDividends, yearTotal])

  const columns = useMemo(() => [
    {
      id: 'date',
      accessorFn: row => row.date,
      header: ({ column }) => (
        <button className="flex items-center gap-1 font-medium text-slate-400 hover:text-slate-200" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Дата {column.getIsSorted() === 'asc' ? <ChevronUp size={12} className="text-slate-500" /> : column.getIsSorted() === 'desc' ? <ChevronDown size={12} className="text-slate-500" /> : <ChevronsUpDown size={12} className="text-slate-500" />}
        </button>
      ),
      cell: ({ getValue }) => <span className="text-slate-200">{formatDate(getValue())}</span>,
    },
    {
      id: 'ticker',
      accessorFn: row => row.ticker,
      header: ({ column }) => (
        <button className="flex items-center gap-1 font-medium text-slate-400 hover:text-slate-200" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Тікер {column.getIsSorted() === 'asc' ? <ChevronUp size={12} className="text-slate-500" /> : column.getIsSorted() === 'desc' ? <ChevronDown size={12} className="text-slate-500" /> : <ChevronsUpDown size={12} className="text-slate-500" />}
        </button>
      ),
      cell: ({ getValue }) => <span className="font-medium text-white">{getValue()}</span>,
    },
    {
      id: 'amount',
      accessorFn: row => Number(row.amount),
      header: ({ column }) => (
        <button className="flex items-center gap-1 font-medium text-slate-400 hover:text-slate-200 ml-auto" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Сума {column.getIsSorted() === 'asc' ? <ChevronUp size={12} className="text-slate-500" /> : column.getIsSorted() === 'desc' ? <ChevronDown size={12} className="text-slate-500" /> : <ChevronsUpDown size={12} className="text-slate-500" />}
        </button>
      ),
      cell: ({ getValue }) => <span className="font-medium text-green-400">{formatMoney(getValue())}</span>,
    },
    {
      id: 'notes',
      accessorFn: row => row.notes || '',
      header: 'Нотатки',
      cell: ({ getValue }) => <span className="text-slate-400">{getValue() || '—'}</span>,
      enableSorting: false,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <button onClick={() => handleDelete(row.original.id)} className="text-red-400 hover:text-red-300 text-xs transition-colors">Вид.</button>
      ),
      enableSorting: false,
    },
  ], [])

  const table = useReactTable({
    data: yearDividends,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-white">Дивіденди та доходи</h2>
        {activeTab === 'history' && (
          <button
            onClick={() => setShowForm(true)}
            className="btn btn-primary"
          >
            + Додати дохід
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex bg-white/8 rounded-lg p-0.5 w-fit mb-5">
        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'history' ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-slate-200'}`}
        >
          Виплати
        </button>
        <button
          onClick={() => setActiveTab('forecast')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'forecast' ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-slate-200'}`}
        >
          Прогноз
        </button>
      </div>

      {activeTab === 'forecast' && <ForecastTab dividends={dividends} />}

      {activeTab === 'history' && <>

      {/* Year selector */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => setSelectedYear(y => y - 1)}
          disabled={!availableYears.includes(selectedYear - 1) && selectedYear <= Math.min(...availableYears)}
          className="text-slate-400 hover:text-slate-200 disabled:opacity-30 px-1 transition-colors"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-lg font-semibold text-slate-200 min-w-[60px] text-center">{selectedYear}</span>
        <button
          onClick={() => setSelectedYear(y => y + 1)}
          disabled={selectedYear >= new Date().getFullYear()}
          className="text-slate-400 hover:text-slate-200 disabled:opacity-30 px-1 transition-colors"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Summary cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 animate-pulse">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="glass-card rounded-xl p-4">
              <div className="h-3 bg-white/10 rounded w-1/2 mb-2" />
              <div className="h-6 bg-white/10 rounded w-3/4" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="glass-card rounded-xl p-4">
            <div className="text-sm text-slate-400">Всього (весь час)</div>
            <div className="text-xl font-bold text-green-400">{formatMoney(total)}</div>
            <div className="text-xs text-slate-500 mt-0.5">{dividends.length} записів</div>
          </div>
          <div className="glass-card rounded-xl p-4">
            <div className="text-sm text-slate-400">За {selectedYear}</div>
            <div className="text-xl font-bold text-green-400">{formatMoney(yearTotal)}</div>
            <div className="text-xs text-slate-500 mt-0.5">{yearDividends.length} записів</div>
          </div>
          <div className="glass-card rounded-xl p-4">
            <div className="text-sm text-slate-400">Середнє / міс</div>
            <div className="text-xl font-bold text-white">{formatMoney(avgPerMonth)}</div>
            <div className="text-xs text-slate-500 mt-0.5">{monthsWithData} міс. з виплатами</div>
          </div>
          <div className="glass-card rounded-xl p-4">
            <div className="text-sm text-slate-400">Тікерів</div>
            <div className="text-xl font-bold text-white">{tickerData.length}</div>
            <div className="text-xs text-slate-500 mt-0.5 truncate">
              {tickerData.slice(0, 4).map(t => t.ticker).join(', ')}
              {tickerData.length > 4 ? '...' : ''}
            </div>
          </div>
        </div>
      )}

      {/* Charts row */}
      {yearDividends.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="lg:col-span-2 glass-card rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-200 mb-4">Помісячні дивіденди — {selectedYear}</h3>
            <div style={{ height: 230 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData} margin={{ top: 20, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.07)" />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#94a3b8' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} tickFormatter={v => `$${v}`} />
                  <Tooltip
                    cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                    formatter={(v) => [formatMoney(v), 'Дивіденди']}
                    labelFormatter={(label) => {
                      const idx = MONTHS.indexOf(label)
                      const name = idx >= 0 ? MONTHS_FULL[idx] : label
                      return <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{name}</span>
                    }}
                    contentStyle={tooltipStyle}
                    itemStyle={{ color: '#e2e8f0' }}
                  />
                  <Bar dataKey="amount" radius={[3, 3, 0, 0]} maxBarSize={48}>
                    {monthlyData.map((entry, i) => (
                      <Cell key={i} fill={entry.amount > 0 ? '#10b981' : 'transparent'} />
                    ))}
                    <LabelList dataKey="amount" position="top" formatter={v => v > 0 ? `$${Math.round(v)}` : ''} style={{ fill: '#94a3b8', fontSize: 11 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="glass-card rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-200 mb-4">По тікерах — {selectedYear}</h3>
            {tickerData.length > 0 ? (
              <div className="space-y-3">
                {tickerData.map((t, i) => (
                  <div key={t.ticker}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-medium text-white">{t.ticker}</span>
                      <span className="text-slate-300">
                        {formatMoney(t.amount)}
                        <span className="text-slate-500 ml-1 text-xs">({t.percent}%)</span>
                      </span>
                    </div>
                    <div className="w-full bg-white/10 rounded-full h-2.5">
                      <div
                        className="h-2.5 rounded-full transition-all"
                        style={{
                          width: `${Math.max(Number(t.percent), 2)}%`,
                          backgroundColor: COLORS[i % COLORS.length],
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-500 text-sm text-center py-8">Немає даних</p>
            )}
          </div>
        </div>
      )}

      {/* Add form */}
      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="glass-card rounded-xl p-4 mb-6">
          <h3 className="font-semibold text-slate-200 mb-3">Новий дохід</h3>
          <div className="flex gap-3 items-start flex-wrap">
            <div>
              <label className="block text-sm text-slate-300 mb-1">Тікер</label>
              <input
                {...register('ticker')}
                className="glass-input w-28"
                placeholder="AAPL"
              />
              {errors.ticker && <p className="text-red-400 text-xs mt-1">{errors.ticker.message}</p>}
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1">Сума (USD)</label>
              <input
                type="number"
                step="any"
                {...register('amount')}
                className="glass-input w-32"
                placeholder="0.00"
              />
              {errors.amount && <p className="text-red-400 text-xs mt-1">{errors.amount.message}</p>}
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1">Дата</label>
              <input
                type="date"
                {...register('date')}
                className="glass-input"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm text-slate-300 mb-1">Нотатки</label>
              <input
                type="text"
                {...register('notes')}
                className="glass-input w-full"
                placeholder="Необов'язково"
              />
            </div>
            <div className="flex gap-2 pt-6">
              <button type="submit" disabled={createDividend.isPending} className="btn btn-primary">
                Додати
              </button>
              <button type="button" onClick={() => { setShowForm(false); reset() }} className="btn btn-ghost">
                Скасувати
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="glass-card rounded-xl overflow-hidden animate-pulse">
          <div className="h-10 bg-white/5 border-b border-white/10" />
          {[1, 2, 3].map(i => (
            <div key={i} className="flex gap-4 px-4 py-3 border-b border-white/[0.06]">
              {[1, 2, 3, 4, 5].map(j => <div key={j} className="h-4 bg-white/[0.06] rounded flex-1" />)}
            </div>
          ))}
        </div>
      ) : yearDividends.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <p className="text-lg mb-2">Немає записів за {selectedYear} рік</p>
          <p className="text-sm">Скористайтесь стрілками для перегляду інших років</p>
        </div>
      ) : (
        <div className="glass-card rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              {table.getHeaderGroups().map(hg => (
                <tr key={hg.id} className="border-b border-white/10 bg-white/5">
                  {hg.headers.map(header => (
                    <th key={header.id} className={`py-3 px-4 ${header.id === 'amount' || header.id === 'actions' ? 'text-right' : 'text-left'}`}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map(row => (
                <tr key={row.id} className="border-b border-white/[0.06] hover:bg-white/5">
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} className={`py-3 px-4 ${cell.column.id === 'amount' || cell.column.id === 'actions' ? 'text-right' : ''}`}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      </>}
    </div>
  )
}
