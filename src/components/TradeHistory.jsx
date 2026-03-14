import { useState, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
} from '@tanstack/react-table'
import { formatMoney, formatDate } from '../lib/formatters'
import { ChevronUp, ChevronDown, ChevronsUpDown, Download } from 'lucide-react'
import { Skeleton } from './ui/skeleton'
import {
  useTradesQuery,
  useUpdateTradeMutation,
  useDeleteTradeMutation,
  useUpdateAdjustmentMutation,
  useDeleteAdjustmentMutation,
} from '../hooks/useTradesQuery'

const TABS = [
  { key: 'trades', label: 'Купівля/продаж' },
  { key: 'adjustments', label: 'Коригування' },
]

const tradeSchema = z.object({
  type: z.enum(['buy', 'sell']),
  price: z.coerce.number().positive('Ціна має бути > 0'),
  quantity: z.coerce.number().positive('Кількість має бути > 0'),
  date: z.string().min(1, 'Дата обов\'язкова'),
  notes: z.string().optional(),
})

const adjSchema = z.object({
  new_balance: z.coerce.number().min(0, 'Баланс не може бути від\'ємним'),
  date: z.string().min(1, 'Дата обов\'язкова'),
  notes: z.string().optional(),
})

function SortableHeader({ column, children, align = 'left' }) {
  const sorted = column.getIsSorted()
  return (
    <button
      className={`flex items-center gap-1 font-medium text-slate-400 hover:text-slate-200 transition-colors ${align === 'right' ? 'ml-auto' : ''}`}
      onClick={() => column.toggleSorting(sorted === 'asc')}
    >
      {children}
      {sorted === 'asc' ? <ChevronUp size={12} className="text-slate-500" /> : sorted === 'desc' ? <ChevronDown size={12} className="text-slate-500" /> : <ChevronsUpDown size={12} className="text-slate-500" />}
    </button>
  )
}

function TableSkeleton({ cols = 8 }) {
  return (
    <div className="glass-card rounded-xl overflow-hidden">
      <div className="h-10 bg-white/5 border-b border-white/10" />
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="flex gap-4 px-4 py-3 border-b border-white/[0.06]">
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}

const modalTooltipStyle = 'bg-white/5 rounded-lg px-3 py-2 text-lg font-semibold text-white'

export default function TradeHistory() {
  const [tab, setTab] = useState('trades')
  const [filterPortfolio, setFilterPortfolio] = useState('')
  const [filterTicker, setFilterTicker] = useState('')
  const [editTrade, setEditTrade] = useState(null)
  const [editAdj, setEditAdj] = useState(null)
  const [tradeSorting, setTradeSorting] = useState([{ id: 'date', desc: true }])
  const [adjSorting, setAdjSorting] = useState([{ id: 'date', desc: true }])

  const { data, isLoading } = useTradesQuery()
  const trades = data?.trades || []
  const adjustments = data?.adjustments || []
  const portfolios = data?.portfolios || []

  const updateTrade = useUpdateTradeMutation()
  const deleteTrade = useDeleteTradeMutation()
  const updateAdj = useUpdateAdjustmentMutation()
  const deleteAdj = useDeleteAdjustmentMutation()

  const { register: registerTrade, handleSubmit: handleSubmitTrade, reset: resetTrade, formState: { errors: tradeErrors } } = useForm({
    resolver: zodResolver(tradeSchema),
  })

  const { register: registerAdj, handleSubmit: handleSubmitAdj, reset: resetAdj, formState: { errors: adjErrors } } = useForm({
    resolver: zodResolver(adjSchema),
  })

  function openEditTrade(trade) {
    setEditTrade(trade)
    resetTrade({
      type: trade.type,
      price: String(trade.price),
      quantity: String(trade.quantity),
      date: trade.date,
      notes: trade.notes || '',
    })
  }

  async function onUpdateTrade(values) {
    try {
      await updateTrade.mutateAsync({
        id: editTrade.id,
        data: {
          type: values.type,
          price: values.price,
          quantity: values.quantity,
          date: values.date,
          notes: values.notes || null,
        },
      })
      setEditTrade(null)
      toast.success('Угоду оновлено')
    } catch (err) {
      toast.error(err.message)
    }
  }

  async function handleDeleteTrade(id) {
    if (!confirm('Видалити цю угоду?')) return
    try {
      await deleteTrade.mutateAsync(id)
      toast.success('Угоду видалено')
    } catch (err) {
      toast.error(err.message)
    }
  }

  function openEditAdj(adj) {
    setEditAdj(adj)
    resetAdj({
      new_balance: String(adj.new_balance),
      date: adj.date,
      notes: adj.notes || '',
    })
  }

  async function onUpdateAdj(values) {
    try {
      await updateAdj.mutateAsync({
        id: editAdj.id,
        data: {
          new_balance: values.new_balance,
          date: values.date,
          notes: values.notes || null,
        },
      })
      setEditAdj(null)
      toast.success('Коригування оновлено')
    } catch (err) {
      toast.error(err.message)
    }
  }

  async function handleDeleteAdj(adj) {
    if (!confirm('Видалити це коригування?')) return
    try {
      await deleteAdj.mutateAsync(adj.id)
      toast.success('Коригування видалено')
    } catch (err) {
      toast.error(err.message)
    }
  }

  const allTickers = useMemo(() =>
    [...new Set(trades.map(t => t.position?.ticker).filter(Boolean))].sort()
  , [trades])

  const filteredTrades = useMemo(() => trades.filter(t => {
    if (filterPortfolio && t.position?.portfolio?.id !== filterPortfolio) return false
    if (filterTicker && t.position?.ticker !== filterTicker) return false
    return true
  }), [trades, filterPortfolio, filterTicker])

  const filteredAdjustments = useMemo(() => adjustments.filter(a => {
    if (filterPortfolio && a.portfolio?.id !== filterPortfolio) return false
    return true
  }), [adjustments, filterPortfolio])

  const tradesColumns = useMemo(() => [
    {
      id: 'date',
      accessorFn: row => row.date,
      header: ({ column }) => <SortableHeader column={column}>Дата</SortableHeader>,
      cell: ({ getValue }) => <span className="text-slate-200">{formatDate(getValue())}</span>,
    },
    {
      id: 'portfolio',
      accessorFn: row => row.position?.portfolio?.name || '',
      header: ({ column }) => <SortableHeader column={column}>Портфель</SortableHeader>,
      cell: ({ getValue }) => <span className="text-slate-200">{getValue() || '—'}</span>,
    },
    {
      id: 'ticker',
      accessorFn: row => row.position?.ticker || '',
      header: ({ column }) => <SortableHeader column={column}>Тікер</SortableHeader>,
      cell: ({ getValue }) => <span className="font-medium text-white">{getValue()}</span>,
    },
    {
      id: 'type',
      accessorFn: row => row.type,
      header: ({ column }) => <SortableHeader column={column}>Тип</SortableHeader>,
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${row.original.type === 'buy' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
            {row.original.type === 'buy' ? 'Купівля' : 'Продаж'}
          </span>
          {row.original.import_id && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-blue-500/15 text-blue-400">
              <Download size={10} /> Імпорт
            </span>
          )}
        </div>
      ),
    },
    {
      id: 'price',
      accessorFn: row => Number(row.price),
      header: ({ column }) => <SortableHeader column={column} align="right">Ціна</SortableHeader>,
      cell: ({ getValue }) => <span className="text-slate-200">{formatMoney(getValue())}</span>,
    },
    {
      id: 'quantity',
      accessorFn: row => Number(row.quantity),
      header: ({ column }) => <SortableHeader column={column} align="right">Кількість</SortableHeader>,
      cell: ({ getValue }) => <span className="text-slate-200">{getValue()}</span>,
    },
    {
      id: 'total',
      accessorFn: row => Number(row.price) * Number(row.quantity),
      header: ({ column }) => <SortableHeader column={column} align="right">Сума</SortableHeader>,
      cell: ({ getValue }) => <span className="font-medium text-white">{formatMoney(getValue())}</span>,
    },
    {
      id: 'notes',
      accessorFn: row => row.notes || '',
      header: 'Нотатки',
      cell: ({ getValue }) => <span className="text-slate-500 text-xs truncate max-w-[150px]">{getValue() || '—'}</span>,
      enableSorting: false,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex gap-2 justify-end whitespace-nowrap">
          <button onClick={() => openEditTrade(row.original)} className="text-blue-400 hover:text-blue-300 text-xs transition-colors">Ред.</button>
          <button onClick={() => handleDeleteTrade(row.original.id)} className="text-red-400 hover:text-red-300 text-xs transition-colors">Вид.</button>
        </div>
      ),
      enableSorting: false,
    },
  ], [])

  const tradesTable = useReactTable({
    data: filteredTrades,
    columns: tradesColumns,
    state: { sorting: tradeSorting },
    onSortingChange: setTradeSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const adjColumns = useMemo(() => [
    {
      id: 'date',
      accessorFn: row => row.date,
      header: ({ column }) => <SortableHeader column={column}>Дата</SortableHeader>,
      cell: ({ getValue }) => <span className="text-slate-200">{formatDate(getValue())}</span>,
    },
    {
      id: 'portfolio',
      accessorFn: row => row.portfolio?.name || '',
      header: ({ column }) => <SortableHeader column={column}>Портфель</SortableHeader>,
      cell: ({ getValue }) => <span className="text-slate-200">{getValue() || '—'}</span>,
    },
    {
      id: 'previous',
      accessorFn: row => Number(row.previous_balance),
      header: ({ column }) => <SortableHeader column={column} align="right">Попередній</SortableHeader>,
      cell: ({ getValue }) => <span className="text-slate-200">{formatMoney(getValue())}</span>,
    },
    {
      id: 'new',
      accessorFn: row => Number(row.new_balance),
      header: ({ column }) => <SortableHeader column={column} align="right">Новий</SortableHeader>,
      cell: ({ getValue }) => <span className="font-medium text-white">{formatMoney(getValue())}</span>,
    },
    {
      id: 'diff',
      accessorFn: row => Number(row.new_balance) - Number(row.previous_balance),
      header: ({ column }) => <SortableHeader column={column} align="right">Різниця</SortableHeader>,
      cell: ({ getValue }) => {
        const diff = getValue()
        return (
          <span className={`font-medium ${diff >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {diff >= 0 ? '+' : ''}{formatMoney(diff)}
          </span>
        )
      },
    },
    {
      id: 'notes',
      accessorFn: row => row.notes || '',
      header: 'Нотатки',
      cell: ({ getValue }) => <span className="text-slate-500 text-xs truncate max-w-[150px]">{getValue() || '—'}</span>,
      enableSorting: false,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex gap-2 justify-end whitespace-nowrap">
          <button onClick={() => openEditAdj(row.original)} className="text-blue-400 hover:text-blue-300 text-xs transition-colors">Ред.</button>
          <button onClick={() => handleDeleteAdj(row.original)} className="text-red-400 hover:text-red-300 text-xs transition-colors">Вид.</button>
        </div>
      ),
      enableSorting: false,
    },
  ], [])

  const adjTable = useReactTable({
    data: filteredAdjustments,
    columns: adjColumns,
    state: { sorting: adjSorting },
    onSortingChange: setAdjSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">Угоди</h2>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-white/10">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setFilterPortfolio(''); setFilterTicker('') }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-blue-400 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <select
          value={filterPortfolio}
          onChange={e => setFilterPortfolio(e.target.value)}
          className="glass-input"
        >
          <option value="">Всі портфелі</option>
          {portfolios.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {tab === 'trades' && (
          <select
            value={filterTicker}
            onChange={e => setFilterTicker(e.target.value)}
            className="glass-input"
          >
            <option value="">Всі активи</option>
            {allTickers.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}
      </div>

      {/* Trades Tab */}
      {tab === 'trades' && (
        isLoading ? <TableSkeleton cols={9} /> :
        filteredTrades.length === 0 ? (
          <p className="text-slate-400 text-center py-8">Немає угод</p>
        ) : (
          <div className="glass-card rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                {tradesTable.getHeaderGroups().map(hg => (
                  <tr key={hg.id} className="border-b border-white/10 bg-white/5">
                    {hg.headers.map(header => (
                      <th key={header.id} className={`py-3 px-3 ${['price', 'quantity', 'total'].includes(header.id) ? 'text-right' : 'text-left'}`}>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {tradesTable.getRowModel().rows.map(row => (
                  <tr key={row.id} className="border-b border-white/[0.06] hover:bg-white/5">
                    {row.getVisibleCells().map(cell => (
                      <td key={cell.id} className={`py-3 px-3 ${['price', 'quantity', 'total', 'actions'].includes(cell.column.id) ? 'text-right' : ''}`}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Adjustments Tab */}
      {tab === 'adjustments' && (
        isLoading ? <TableSkeleton cols={7} /> :
        filteredAdjustments.length === 0 ? (
          <p className="text-slate-400 text-center py-8">Немає коригувань</p>
        ) : (
          <div className="glass-card rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                {adjTable.getHeaderGroups().map(hg => (
                  <tr key={hg.id} className="border-b border-white/10 bg-white/5">
                    {hg.headers.map(header => (
                      <th key={header.id} className={`py-3 px-3 ${['previous', 'new', 'diff'].includes(header.id) ? 'text-right' : 'text-left'}`}>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {adjTable.getRowModel().rows.map(row => (
                  <tr key={row.id} className="border-b border-white/[0.06] hover:bg-white/5">
                    {row.getVisibleCells().map(cell => (
                      <td key={cell.id} className={`py-3 px-3 ${['previous', 'new', 'diff', 'actions'].includes(cell.column.id) ? 'text-right' : ''}`}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Edit Trade Modal */}
      {editTrade && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <form onSubmit={handleSubmitTrade(onUpdateTrade)} className="glass-modal rounded-xl p-6 w-full max-w-md">
            <h3 className="font-semibold text-white mb-4">
              Редагувати угоду — {editTrade.position?.ticker}
            </h3>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-sm text-slate-300 mb-1">Тип</label>
                <select {...registerTrade('type')} className="glass-input w-full">
                  <option value="buy">Купівля</option>
                  <option value="sell">Продаж</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Дата</label>
                <input type="date" {...registerTrade('date')} className="glass-input w-full" />
                {tradeErrors.date && <p className="text-red-400 text-xs mt-1">{tradeErrors.date.message}</p>}
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Ціна</label>
                <input type="number" step="any" {...registerTrade('price')} className="glass-input w-full" />
                {tradeErrors.price && <p className="text-red-400 text-xs mt-1">{tradeErrors.price.message}</p>}
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Кількість</label>
                <input type="number" step="any" {...registerTrade('quantity')} className="glass-input w-full" />
                {tradeErrors.quantity && <p className="text-red-400 text-xs mt-1">{tradeErrors.quantity.message}</p>}
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-sm text-slate-300 mb-1">Нотатки</label>
              <input type="text" {...registerTrade('notes')} className="glass-input w-full" placeholder="Необов'язково" />
            </div>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setEditTrade(null)} className="text-slate-400 hover:text-slate-200 px-4 py-2 text-sm transition-colors">Скасувати</button>
              <button type="submit" disabled={updateTrade.isPending} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">Зберегти</button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Adjustment Modal */}
      {editAdj && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <form onSubmit={handleSubmitAdj(onUpdateAdj)} className="glass-modal rounded-xl p-6 w-full max-w-md">
            <h3 className="font-semibold text-white mb-4">
              Редагувати коригування — {editAdj.portfolio?.name}
            </h3>
            <div className="mb-3">
              <label className="block text-sm text-slate-300 mb-1">Дата</label>
              <input type="date" {...registerAdj('date')} className="glass-input w-full" />
              {adjErrors.date && <p className="text-red-400 text-xs mt-1">{adjErrors.date.message}</p>}
            </div>
            <div className="mb-3">
              <label className="block text-sm text-slate-300 mb-1">Попередній баланс</label>
              <div className={modalTooltipStyle}>
                {formatMoney(editAdj.previous_balance)}
              </div>
            </div>
            <div className="mb-3">
              <label className="block text-sm text-slate-300 mb-1">Новий баланс</label>
              <input type="number" step="any" {...registerAdj('new_balance')} className="glass-input w-full" />
              {adjErrors.new_balance && <p className="text-red-400 text-xs mt-1">{adjErrors.new_balance.message}</p>}
            </div>
            <div className="mb-4">
              <label className="block text-sm text-slate-300 mb-1">Нотатки</label>
              <input type="text" {...registerAdj('notes')} className="glass-input w-full" placeholder="Необов'язково" />
            </div>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setEditAdj(null)} className="text-slate-400 hover:text-slate-200 px-4 py-2 text-sm transition-colors">Скасувати</button>
              <button type="submit" disabled={updateAdj.isPending} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">Зберегти</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
