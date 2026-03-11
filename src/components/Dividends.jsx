import { useState, useMemo } from 'react'
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
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'

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

export default function Dividends() {
  const [showForm, setShowForm] = useState(false)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [sorting, setSorting] = useState([{ id: 'date', desc: true }])

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

  // Computed data
  const total = dividends.reduce((sum, d) => sum + Number(d.amount), 0)

  const availableYears = useMemo(() => {
    const years = new Set(dividends.map(d => new Date(d.date).getFullYear()))
    if (years.size === 0) years.add(new Date().getFullYear())
    return [...years].sort((a, b) => b - a)
  }, [dividends])

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

  // TanStack Table
  const columns = useMemo(() => [
    {
      id: 'date',
      accessorFn: row => row.date,
      header: ({ column }) => (
        <button className="flex items-center gap-1 font-medium text-gray-600 hover:text-gray-900" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Дата <span className="text-[10px] text-gray-400">{column.getIsSorted() === 'asc' ? '▲' : column.getIsSorted() === 'desc' ? '▼' : '⇅'}</span>
        </button>
      ),
      cell: ({ getValue }) => <span className="text-gray-700">{formatDate(getValue())}</span>,
    },
    {
      id: 'ticker',
      accessorFn: row => row.ticker,
      header: ({ column }) => (
        <button className="flex items-center gap-1 font-medium text-gray-600 hover:text-gray-900" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Тікер <span className="text-[10px] text-gray-400">{column.getIsSorted() === 'asc' ? '▲' : column.getIsSorted() === 'desc' ? '▼' : '⇅'}</span>
        </button>
      ),
      cell: ({ getValue }) => <span className="font-medium text-gray-800">{getValue()}</span>,
    },
    {
      id: 'amount',
      accessorFn: row => Number(row.amount),
      header: ({ column }) => (
        <button className="flex items-center gap-1 font-medium text-gray-600 hover:text-gray-900 ml-auto" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Сума <span className="text-[10px] text-gray-400">{column.getIsSorted() === 'asc' ? '▲' : column.getIsSorted() === 'desc' ? '▼' : '⇅'}</span>
        </button>
      ),
      cell: ({ getValue }) => <span className="font-medium text-green-600">{formatMoney(getValue())}</span>,
    },
    {
      id: 'notes',
      accessorFn: row => row.notes || '',
      header: 'Нотатки',
      cell: ({ getValue }) => <span className="text-gray-500">{getValue() || '—'}</span>,
      enableSorting: false,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <button onClick={() => handleDelete(row.original.id)} className="text-red-500 hover:text-red-700 text-xs">Вид.</button>
      ),
      enableSorting: false,
    },
  ], [])

  const table = useReactTable({
    data: dividends,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Дивіденди та доходи</h2>
        <button
          onClick={() => setShowForm(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          + Додати дохід
        </button>
      </div>

      {/* Year selector */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => setSelectedYear(y => y - 1)}
          disabled={!availableYears.includes(selectedYear - 1) && selectedYear <= Math.min(...availableYears)}
          className="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-lg px-1"
        >
          ←
        </button>
        <span className="text-lg font-semibold text-gray-700 min-w-[60px] text-center">{selectedYear}</span>
        <button
          onClick={() => setSelectedYear(y => y + 1)}
          disabled={selectedYear >= new Date().getFullYear()}
          className="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-lg px-1"
        >
          →
        </button>
      </div>

      {/* Summary cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 animate-pulse">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="h-3 bg-gray-200 rounded w-1/2 mb-2" />
              <div className="h-6 bg-gray-200 rounded w-3/4" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-sm text-gray-500">Всього (весь час)</div>
            <div className="text-xl font-bold text-green-600">{formatMoney(total)}</div>
            <div className="text-xs text-gray-400 mt-0.5">{dividends.length} записів</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-sm text-gray-500">За {selectedYear}</div>
            <div className="text-xl font-bold text-green-600">{formatMoney(yearTotal)}</div>
            <div className="text-xs text-gray-400 mt-0.5">{yearDividends.length} записів</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-sm text-gray-500">Середнє / міс</div>
            <div className="text-xl font-bold text-gray-800">{formatMoney(avgPerMonth)}</div>
            <div className="text-xs text-gray-400 mt-0.5">{monthsWithData} міс. з виплатами</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-sm text-gray-500">Тікерів</div>
            <div className="text-xl font-bold text-gray-800">{tickerData.length}</div>
            <div className="text-xs text-gray-400 mt-0.5 truncate">
              {tickerData.slice(0, 4).map(t => t.ticker).join(', ')}
              {tickerData.length > 4 ? '...' : ''}
            </div>
          </div>
        </div>
      )}

      {/* Charts row */}
      {yearDividends.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Помісячні дивіденди — {selectedYear}</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={monthlyData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `$${v}`} />
                <Tooltip
                  formatter={(v) => [formatMoney(v), 'Дивіденди']}
                  labelFormatter={(label, payload) => {
                    if (payload?.[0]) {
                      const idx = MONTHS.indexOf(label)
                      return idx >= 0 ? MONTHS_FULL[idx] : label
                    }
                    return label
                  }}
                />
                <Bar dataKey="amount" radius={[4, 4, 0, 0]} maxBarSize={48}>
                  {monthlyData.map((entry, i) => (
                    <Cell key={i} fill={entry.amount > 0 ? '#10B981' : '#E5E7EB'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">По тікерах — {selectedYear}</h3>
            {tickerData.length > 0 ? (
              <div className="space-y-3">
                {tickerData.map((t, i) => (
                  <div key={t.ticker}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-medium text-gray-800">{t.ticker}</span>
                      <span className="text-gray-600">
                        {formatMoney(t.amount)}
                        <span className="text-gray-400 ml-1 text-xs">({t.percent}%)</span>
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2.5">
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
              <p className="text-gray-400 text-sm text-center py-8">Немає даних</p>
            )}
          </div>
        </div>
      )}

      {/* Add form */}
      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <h3 className="font-semibold text-gray-700 mb-3">Новий дохід</h3>
          <div className="flex gap-3 items-start flex-wrap">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Тікер</label>
              <input
                {...register('ticker')}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="AAPL"
              />
              {errors.ticker && <p className="text-red-500 text-xs mt-1">{errors.ticker.message}</p>}
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Сума (USD)</label>
              <input
                type="number"
                step="any"
                {...register('amount')}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
              />
              {errors.amount && <p className="text-red-500 text-xs mt-1">{errors.amount.message}</p>}
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Дата</label>
              <input
                type="date"
                {...register('date')}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm text-gray-600 mb-1">Нотатки</label>
              <input
                type="text"
                {...register('notes')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Необов'язково"
              />
            </div>
            <div className="flex gap-2 pt-6">
              <button type="submit" disabled={createDividend.isPending} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                Додати
              </button>
              <button type="button" onClick={() => { setShowForm(false); reset() }} className="text-gray-500 px-3 py-2 text-sm">
                Скасувати
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden animate-pulse">
          <div className="h-10 bg-gray-100 border-b border-gray-200" />
          {[1, 2, 3].map(i => (
            <div key={i} className="flex gap-4 px-4 py-3 border-b border-gray-100">
              {[1, 2, 3, 4, 5].map(j => <div key={j} className="h-4 bg-gray-100 rounded flex-1" />)}
            </div>
          ))}
        </div>
      ) : dividends.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg mb-2">Немає записів</p>
          <p className="text-sm">Додайте перший дохід від дивідендів</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              {table.getHeaderGroups().map(hg => (
                <tr key={hg.id} className="border-b border-gray-200 bg-gray-50">
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
                <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50">
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
    </div>
  )
}
