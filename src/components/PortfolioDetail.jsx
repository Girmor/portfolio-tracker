import { useState, useMemo, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
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
import { formatMoney, formatNumber, formatPercent, pnlColor } from '../lib/formatters'
import { PieChart, Pie, Cell, Tooltip } from 'recharts'
import { searchStocks, searchCrypto } from '../lib/priceService'
import { ChevronUp, ChevronDown, ChevronsUpDown, Plus, Trash2, X } from 'lucide-react'
import {
  usePortfolioDetailQuery,
  useAddPositionMutation,
  useDeletePositionMutation,
  useAddTradeMutation,
  useCashAdjustmentMutation,
} from '../hooks/usePortfoliosQuery'
import { usePricesQuery } from '../hooks/usePricesQuery'
import PortfolioHistoryChart from './PortfolioHistoryChart'

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16']

const tradeSchema = z.object({
  type: z.enum(['buy', 'sell']),
  price: z.coerce.number().positive('Ціна має бути > 0'),
  quantity: z.coerce.number().positive('Кількість має бути > 0'),
  date: z.string().min(1, 'Дата обов\'язкова'),
  notes: z.string().optional(),
})

const cashSchema = z.object({
  date: z.string().min(1, 'Дата обов\'язкова'),
  newBalance: z.coerce.number().min(0, 'Баланс не може бути від\'ємним'),
})

const tooltipStyle = {
  background: '#1e293b',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 8,
  color: '#e2e8f0',
}

function SortableHeader({ column, children }) {
  const sorted = column.getIsSorted()
  return (
    <button
      className="flex items-center gap-1 font-medium text-slate-400 hover:text-slate-200 transition-colors"
      onClick={() => column.toggleSorting(sorted === 'asc')}
    >
      {children}
      {sorted === 'asc' ? <ChevronUp size={12} className="text-slate-500" /> : sorted === 'desc' ? <ChevronDown size={12} className="text-slate-500" /> : <ChevronsUpDown size={12} className="text-slate-500" />}
    </button>
  )
}

function SkeletonDetail() {
  return (
    <div className="animate-pulse">
      <div className="grid grid-cols-2 gap-3 mb-6 lg:w-2/3">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="glass-card rounded-xl p-4">
            <div className="h-3 bg-white/10 rounded w-1/2 mb-2" />
            <div className="h-6 bg-white/10 rounded w-3/4" />
          </div>
        ))}
      </div>
      <div className="h-12 bg-white/10 rounded mb-4" />
      <div className="glass-card rounded-xl h-48" />
    </div>
  )
}

export default function PortfolioDetail() {
  const { id } = useParams()
  const [showAddPosition, setShowAddPosition] = useState(false)
  const [showAddTrade, setShowAddTrade] = useState(null)
  const [showCashModal, setShowCashModal] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [posForm, setPosForm] = useState({ ticker: '', name: '', type: 'stock', coinId: '' })
  const [holdingsSorting, setHoldingsSorting] = useState([])

  const { data, isLoading, error } = usePortfolioDetailQuery(id)
  const portfolio = data?.portfolio
  const positions = data?.positions || []

  const { data: prices = {} } = usePricesQuery(positions)


  const addPosition = useAddPositionMutation(id)
  const deletePosition = useDeletePositionMutation(id)
  const addTrade = useAddTradeMutation(id)
  const cashAdjustment = useCashAdjustmentMutation(id)

  const { register: registerTrade, handleSubmit: handleSubmitTrade, reset: resetTrade, setValue: setValueTrade, formState: { errors: tradeErrors } } = useForm({
    resolver: zodResolver(tradeSchema),
    defaultValues: { type: 'buy', price: '', quantity: '', date: new Date().toISOString().split('T')[0], notes: '' },
  })

  const { register: registerCash, handleSubmit: handleSubmitCash, reset: resetCash, formState: { errors: cashErrors } } = useForm({
    resolver: zodResolver(cashSchema),
    defaultValues: { date: new Date().toISOString().split('T')[0], newBalance: '' },
  })

  function calcPosition(pos) {
    const trades = pos.trades || []
    let totalBuyQty = 0, totalBuyCost = 0
    let totalSellQty = 0, totalSellProceeds = 0
    trades.forEach(t => {
      const qty = Number(t.quantity)
      const price = Number(t.price)
      if (t.type === 'buy') {
        totalBuyQty += qty
        totalBuyCost += price * qty
      } else {
        totalSellQty += qty
        totalSellProceeds += price * qty
      }
    })
    const avgPrice = totalBuyQty > 0 ? totalBuyCost / totalBuyQty : 0
    const remainingQty = totalBuyQty - totalSellQty
    const investedRemaining = avgPrice * remainingQty
    const currentPrice = prices[pos.ticker] ?? 0
    const marketValue = remainingQty * currentPrice

    const realizedPnl = totalSellQty > 0 ? totalSellProceeds - (avgPrice * totalSellQty) : 0
    const realizedCost = avgPrice * totalSellQty
    const realizedPnlPercent = realizedCost > 0 ? (realizedPnl / realizedCost) * 100 : 0

    const unrealizedPnl = marketValue - investedRemaining
    const unrealizedPnlPercent = investedRemaining > 0 ? (unrealizedPnl / investedRemaining) * 100 : 0

    return {
      totalQty: remainingQty, avgPrice, totalCost: investedRemaining,
      currentPrice, marketValue,
      unrealizedPnl, unrealizedPnlPercent,
      realizedPnl, realizedPnlPercent,
      totalBuyQty, totalBuyCost, totalSellProceeds,
    }
  }

  async function handleTickerInput(value, type) {
    setPosForm(f => ({ ...f, ticker: value, name: '' }))
    setShowSuggestions(true)
    if (value.length < 1) { setSuggestions([]); return }
    const timeout = setTimeout(async () => {
      setSearchLoading(true)
      const results = type === 'crypto' ? await searchCrypto(value) : await searchStocks(value)
      setSuggestions(results)
      setSearchLoading(false)
    }, 300)
    return () => clearTimeout(timeout)
  }

  function selectSuggestion(item) {
    setPosForm(f => ({ ...f, ticker: item.ticker, name: item.name, coinId: item.coinId || '' }))
    setSuggestions([])
    setShowSuggestions(false)
  }

  async function handleAddPosition(e) {
    e.preventDefault()
    try {
      await addPosition.mutateAsync({
        ticker: posForm.ticker.toUpperCase(),
        name: posForm.name,
        type: posForm.type,
        coin_id: posForm.coinId || null,
        portfolio_id: id,
      })
      setPosForm({ ticker: '', name: '', type: 'stock', coinId: '' })
      setShowAddPosition(false)
      toast.success('Позицію додано')
    } catch (err) {
      toast.error(err.message)
    }
  }

  async function onAddTrade(values) {
    try {
      await addTrade.mutateAsync({
        position_id: showAddTrade,
        type: values.type,
        price: values.price,
        quantity: values.quantity,
        date: values.date,
        notes: values.notes || null,
      })
      resetTrade()
      setShowAddTrade(null)
      toast.success('Угоду додано')
    } catch (err) {
      toast.error(err.message)
    }
  }

  async function handleDeletePosition(posId) {
    if (!confirm('Видалити позицію та всі її угоди?')) return
    try {
      await deletePosition.mutateAsync(posId)
      toast.success('Позицію видалено')
    } catch (err) {
      toast.error(err.message)
    }
  }

  async function onCashAdjustment(values) {
    try {
      await cashAdjustment.mutateAsync({
        previousBalance: cashBalance,
        newBalance: values.newBalance,
        date: values.date,
      })
      resetCash()
      setShowCashModal(false)
      toast.success('Баланс оновлено')
    } catch (err) {
      toast.error(err.message)
    }
  }

  const cashBalance = Number(portfolio?.cash_balance) || 0
  const posCalcs = useMemo(
    () => positions.map(p => ({ pos: p, calc: calcPosition(p) })),
    [positions, prices] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const activePositions = useMemo(() => posCalcs.filter(({ calc, pos }) => calc.totalQty > 0 || (pos.trades?.length ?? 0) === 0), [posCalcs])
  const soldPositions = useMemo(() => posCalcs.filter(({ calc }) => calc.totalQty <= 0 && (calc.realizedPnl !== 0 || (calc.pos?.trades?.length ?? 0) > 0)), [posCalcs])
  const totalInvestmentValue = useMemo(() => activePositions.reduce((sum, { calc }) => sum + calc.marketValue, 0), [activePositions])
  const totalValue = totalInvestmentValue + cashBalance
  const totalCost = useMemo(() => activePositions.reduce((sum, { calc }) => sum + calc.totalCost, 0), [activePositions])
  const totalUnrealizedPnl = useMemo(() => activePositions.reduce((sum, { calc }) => sum + calc.unrealizedPnl, 0), [activePositions])
  const totalRealizedPnl = useMemo(() => posCalcs.reduce((sum, { calc }) => sum + calc.realizedPnl, 0), [posCalcs])
  const unrealizedPnlPercent = totalCost > 0 ? (totalUnrealizedPnl / totalCost) * 100 : 0
  const soldTotalRealizedPnl = useMemo(() => soldPositions.reduce((sum, { calc }) => sum + calc.realizedPnl, 0), [soldPositions])

  const allocationData = useMemo(() => activePositions
    .map(({ pos, calc }) => ({ name: pos.ticker, value: Math.max(0, calc.marketValue) }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value), [activePositions])

  const bestPerformer = useMemo(() => activePositions.reduce((best, item) =>
    !best || item.calc.unrealizedPnlPercent > best.calc.unrealizedPnlPercent ? item : best
  , null), [activePositions])
  const worstPerformer = useMemo(() => activePositions.reduce((worst, item) =>
    !worst || item.calc.unrealizedPnlPercent < worst.calc.unrealizedPnlPercent ? item : worst
  , null), [activePositions])

  const holdingsColumns = useMemo(() => [
    {
      id: 'ticker',
      accessorFn: row => row.pos.ticker,
      header: ({ column }) => <SortableHeader column={column}>Назва</SortableHeader>,
      cell: ({ row }) => (
        <div>
          <div className="font-medium text-white">{row.original.pos.ticker}</div>
          <div className="text-xs text-slate-500 truncate max-w-[140px]">{row.original.pos.name || (row.original.pos.type === 'stock' ? 'Акція' : 'Крипто')}</div>
        </div>
      ),
    },
    {
      id: 'qty',
      accessorFn: row => row.calc.totalQty,
      header: ({ column }) => <SortableHeader column={column}>Кількість</SortableHeader>,
      cell: ({ row }) => <span className="text-slate-200">{formatNumber(row.original.calc.totalQty, 4)}</span>,
    },
    {
      id: 'avgPrice',
      accessorFn: row => row.calc.avgPrice,
      header: ({ column }) => <SortableHeader column={column}>Сер. ціна</SortableHeader>,
      cell: ({ row }) => <span className="text-slate-200">{formatMoney(row.original.calc.avgPrice)}</span>,
    },
    {
      id: 'currentPrice',
      accessorFn: row => row.calc.currentPrice,
      header: ({ column }) => <SortableHeader column={column}>Ціна</SortableHeader>,
      cell: ({ row }) => <span className="text-slate-200">{row.original.calc.currentPrice ? formatMoney(row.original.calc.currentPrice) : '---'}</span>,
    },
    {
      id: 'totalCost',
      accessorFn: row => row.calc.totalCost,
      header: ({ column }) => <SortableHeader column={column}>Інвестовано</SortableHeader>,
      cell: ({ row }) => <span className="text-slate-200">{formatMoney(row.original.calc.totalCost)}</span>,
    },
    {
      id: 'marketValue',
      accessorFn: row => row.calc.marketValue,
      header: ({ column }) => <SortableHeader column={column}>Ринкова вар.</SortableHeader>,
      cell: ({ row }) => <span className="font-medium text-white">{formatMoney(row.original.calc.marketValue)}</span>,
    },
    {
      id: 'unrealizedPnl',
      accessorFn: row => row.calc.unrealizedPnl,
      header: ({ column }) => <SortableHeader column={column}>Нереаліз. P&L</SortableHeader>,
      cell: ({ row }) => <span className={`font-medium ${pnlColor(row.original.calc.unrealizedPnl)}`}>{formatMoney(row.original.calc.unrealizedPnl)}</span>,
    },
    {
      id: 'unrealizedPct',
      accessorFn: row => row.calc.unrealizedPnlPercent,
      header: ({ column }) => <SortableHeader column={column}>Нереаліз. %</SortableHeader>,
      cell: ({ row }) => <span className={`font-medium ${pnlColor(row.original.calc.unrealizedPnlPercent)}`}>{formatPercent(row.original.calc.unrealizedPnlPercent)}</span>,
    },
    {
      id: 'realizedPnl',
      accessorFn: row => row.calc.realizedPnl,
      header: ({ column }) => <SortableHeader column={column}>Реаліз. P&L</SortableHeader>,
      cell: ({ row }) => <span className={`font-medium ${pnlColor(row.original.calc.realizedPnl)}`}>{row.original.calc.realizedPnl !== 0 ? formatMoney(row.original.calc.realizedPnl) : '—'}</span>,
    },
    {
      id: 'realizedPct',
      accessorFn: row => row.calc.realizedPnlPercent,
      header: ({ column }) => <SortableHeader column={column}>Реаліз. %</SortableHeader>,
      cell: ({ row }) => <span className={`font-medium ${pnlColor(row.original.calc.realizedPnlPercent)}`}>{row.original.calc.realizedPnl !== 0 ? formatPercent(row.original.calc.realizedPnlPercent) : '—'}</span>,
    },
    {
      id: 'allocation',
      accessorFn: row => totalInvestmentValue > 0 ? (row.calc.marketValue / totalInvestmentValue) * 100 : 0,
      header: ({ column }) => <SortableHeader column={column}>Алокація</SortableHeader>,
      cell: ({ getValue }) => <span className="text-slate-200">{getValue().toFixed(2)}%</span>,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex gap-2 justify-end whitespace-nowrap">
          <button
            onClick={() => {
              setShowAddTrade(row.original.pos.id)
              setValueTrade('price', prices[row.original.pos.ticker] ? String(prices[row.original.pos.ticker]) : '')
              setValueTrade('date', new Date().toISOString().split('T')[0])
            }}
            className="text-blue-400 hover:text-blue-300 text-xs transition-colors"
          >
            +Угода
          </button>
          <button
            onClick={() => handleDeletePosition(row.original.pos.id)}
            className="text-red-400 hover:text-red-300 text-xs transition-colors"
          >
            Вид.
          </button>
        </div>
      ),
      enableSorting: false,
    },
  ], [prices, totalInvestmentValue])

  const holdingsTable = useReactTable({
    data: activePositions,
    columns: holdingsColumns,
    state: { sorting: holdingsSorting },
    onSortingChange: setHoldingsSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  useEffect(() => {
    if (!showAddTrade && !showCashModal) return
    function onKey(e) {
      if (e.key === 'Escape') {
        if (showAddTrade) { setShowAddTrade(null); resetTrade() }
        if (showCashModal) setShowCashModal(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [showAddTrade, showCashModal])

  if (isLoading) return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link to="/portfolios" className="text-slate-400 hover:text-slate-200 transition-colors">← Назад</Link>
        <div className="h-7 bg-white/10 rounded w-48 animate-pulse" />
      </div>
      <SkeletonDetail />
    </div>
  )
  if (error || !portfolio) return <div className="text-red-400">Портфель не знайдено</div>

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link to="/portfolios" className="text-slate-400 hover:text-slate-200 transition-colors">← Назад</Link>
        <h2 className="text-2xl font-bold text-white">{portfolio.name}</h2>
      </div>

      {/* Summary Stats + Allocation Row */}
      <div className="flex flex-col lg:flex-row gap-3 mb-6">
        <div className="lg:w-2/3 grid grid-cols-2 gap-3">
          <div className="glass-card rounded-xl p-4">
            <div className="text-xs text-slate-400 mb-1">Вартість портфеля</div>
            <div className="text-xl font-bold text-white">{formatMoney(totalValue)}</div>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-xs text-slate-500">Готівка: {formatMoney(cashBalance)}</span>
              <button
                onClick={() => {
                  resetCash({ date: new Date().toISOString().split('T')[0], newBalance: String(cashBalance) })
                  setShowCashModal(true)
                }}
                className="text-[10px] text-blue-400 hover:text-blue-300 font-medium border border-blue-400/30 rounded px-1.5 py-0.5 transition-colors"
              >
                Коригування
              </button>
            </div>
          </div>

          <div className="glass-card rounded-xl p-4">
            <div className="text-xs text-slate-400 mb-1">Інвестовано</div>
            <div className="text-xl font-bold text-white">{formatMoney(totalCost)}</div>
            <div className={`text-xs mt-1.5 ${pnlColor(totalUnrealizedPnl)}`}>
              P&L: {formatMoney(totalUnrealizedPnl)} ({formatPercent(unrealizedPnlPercent)})
            </div>
          </div>

          <div className="glass-card rounded-xl p-4">
            <div className="text-xs text-slate-400 mb-1">Найкращий актив</div>
            {bestPerformer ? (
              <>
                <div className="text-xl font-bold text-white">{bestPerformer.pos.ticker}</div>
                <div className="text-xs text-green-400 mt-1.5">
                  {formatMoney(bestPerformer.calc.unrealizedPnl)} &nbsp;{formatPercent(bestPerformer.calc.unrealizedPnlPercent)}
                </div>
              </>
            ) : (
              <div className="text-sm text-slate-500 mt-1">—</div>
            )}
          </div>

          <div className="glass-card rounded-xl p-4">
            <div className="text-xs text-slate-400 mb-1">Найгірший актив</div>
            {worstPerformer ? (
              <>
                <div className="text-xl font-bold text-white">{worstPerformer.pos.ticker}</div>
                <div className="text-xs text-red-400 mt-1.5">
                  {formatMoney(worstPerformer.calc.unrealizedPnl)} &nbsp;{formatPercent(worstPerformer.calc.unrealizedPnlPercent)}
                </div>
              </>
            ) : (
              <div className="text-sm text-slate-500 mt-1">—</div>
            )}
          </div>
        </div>

        {allocationData.length > 0 && (
          <div className="glass-card rounded-xl p-4 lg:w-1/3 shrink-0">
            <div className="text-xs text-slate-400 mb-2">Алокація</div>
            <div className="flex items-center justify-center gap-5">
              <div style={{ width: 128, height: 128 }} className="shrink-0">
                <PieChart width={128} height={128}>
                  <Pie data={allocationData} cx="50%" cy="50%" innerRadius={42} outerRadius={62} paddingAngle={3} cornerRadius={4} dataKey="value">
                    {allocationData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => formatMoney(v)} contentStyle={tooltipStyle} />
                </PieChart>
              </div>
              <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: '140px' }}>
                {allocationData.map((item, i) => {
                  const percent = totalInvestmentValue > 0
                    ? ((item.value / totalInvestmentValue) * 100).toFixed(1)
                    : '0.0'
                  return (
                    <div key={item.name} className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="text-sm text-slate-200 whitespace-nowrap">{item.name}</span>
                      <span className="text-sm text-slate-400 tabular-nums">{percent}%</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      <PortfolioHistoryChart portfolioId={id} positions={positions} currentPrices={prices} />

      {/* Holdings Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-slate-200">Холдинги</h3>
        <button
          onClick={() => setShowAddPosition(true)}
          className="btn btn-primary"
        >
          + Додати позицію
        </button>
      </div>

      {/* Add Position Form */}
      {showAddPosition && (
        <form onSubmit={handleAddPosition} className="glass-card rounded-xl p-4 mb-4">
          <div className="flex gap-3 items-end">
            <div>
              <label className="block text-sm text-slate-300 mb-1">Тип</label>
              <select
                value={posForm.type}
                onChange={e => setPosForm(f => ({ ...f, type: e.target.value }))}
                className="glass-input"
              >
                <option value="stock">Акція</option>
                <option value="crypto">Крипто</option>
              </select>
            </div>
            <div className="relative flex-1">
              <label className="block text-sm text-slate-300 mb-1">Пошук активу</label>
              <input
                type="text"
                required
                autoComplete="off"
                value={posForm.ticker}
                onChange={e => handleTickerInput(e.target.value, posForm.type)}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                className="glass-input w-full"
                placeholder={posForm.type === 'crypto' ? 'BTC, Ethereum...' : 'AAPL, Tesla...'}
              />
              {searchLoading && <div className="absolute right-3 top-8 text-xs text-slate-400">Пошук...</div>}
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 glass-modal rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {suggestions.map((item, i) => (
                    <button
                      key={`${item.ticker}-${i}`}
                      type="button"
                      onMouseDown={() => selectSuggestion(item)}
                      className="w-full text-left px-3 py-2 hover:bg-white/5 flex items-center justify-between text-sm border-b border-white/[0.06] last:border-0"
                    >
                      <div>
                        <span className="font-medium text-white">{item.ticker}</span>
                        <span className="text-slate-400 ml-2">{item.name}</span>
                      </div>
                      {item.type && <span className="text-xs text-slate-500">{item.type}</span>}
                    </button>
                  ))}
                </div>
              )}
              {posForm.name && <div className="text-xs text-green-400 mt-1">Обрано: {posForm.ticker} — {posForm.name}</div>}
            </div>
            <button type="submit" disabled={addPosition.isPending} className="btn btn-primary">
              Додати
            </button>
            <button type="button" onClick={() => setShowAddPosition(false)} className="btn btn-ghost">
              Скасувати
            </button>
          </div>
        </form>
      )}

      {/* Holdings TanStack Table */}
      {activePositions.length === 0 && soldPositions.length === 0 ? (
        <p className="text-slate-400 text-center py-8">Додайте першу позицію</p>
      ) : activePositions.length === 0 ? (
        <p className="text-slate-400 text-center py-8">Немає активних позицій</p>
      ) : (
        <div className="glass-card rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead>
              {holdingsTable.getHeaderGroups().map(hg => (
                <tr key={hg.id} className="border-b border-white/10 bg-white/5">
                  {hg.headers.map(header => (
                    <th key={header.id} className="py-3 px-3 text-left">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {holdingsTable.getRowModel().rows.map(row => (
                <tr key={row.id} className="border-b border-white/[0.06] hover:bg-white/5">
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} className={`py-3 px-3 ${cell.column.id !== 'ticker' && cell.column.id !== 'actions' ? 'text-right' : ''}`}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-white/15 bg-white/5 font-medium">
                <td className="py-3 px-3 text-white">Всього</td>
                <td className="text-right py-3 px-3" />
                <td className="text-right py-3 px-3" />
                <td className="text-right py-3 px-3" />
                <td className="text-right py-3 px-3 text-white">{formatMoney(totalCost)}</td>
                <td className="text-right py-3 px-3 text-white">{formatMoney(totalInvestmentValue)}</td>
                <td className={`text-right py-3 px-3 ${pnlColor(totalUnrealizedPnl)}`}>{formatMoney(totalUnrealizedPnl)}</td>
                <td className={`text-right py-3 px-3 ${pnlColor(unrealizedPnlPercent)}`}>{formatPercent(unrealizedPnlPercent)}</td>
                <td className={`text-right py-3 px-3 ${pnlColor(totalRealizedPnl)}`}>{totalRealizedPnl !== 0 ? formatMoney(totalRealizedPnl) : '—'}</td>
                <td className="text-right py-3 px-3" />
                <td className="text-right py-3 px-3 text-white">100%</td>
                <td className="text-right py-3 px-3" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Sold Positions Table */}
      {soldPositions.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-semibold text-slate-200 mb-4">Продані активи</h3>
          <div className="glass-card rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="text-left py-3 px-3 font-medium text-slate-300">Назва</th>
                  <th className="text-right py-3 px-3 font-medium text-slate-300">Куплено (шт.)</th>
                  <th className="text-right py-3 px-3 font-medium text-slate-300">Сер. ціна купівлі</th>
                  <th className="text-right py-3 px-3 font-medium text-slate-300">Інвестовано</th>
                  <th className="text-right py-3 px-3 font-medium text-slate-300">Виручка</th>
                  <th className="text-right py-3 px-3 font-medium text-slate-300">Реаліз. P&L</th>
                  <th className="text-right py-3 px-3 font-medium text-slate-300">Реаліз. %</th>
                  <th className="text-right py-3 px-3 font-medium text-slate-300">Дії</th>
                </tr>
              </thead>
              <tbody>
                {soldPositions.map(({ pos, calc }) => (
                  <tr key={pos.id} className="border-b border-white/[0.06] hover:bg-white/5">
                    <td className="py-3 px-3">
                      <div className="font-medium text-slate-400">{pos.ticker}</div>
                      <div className="text-xs text-slate-500 truncate max-w-[140px]">{pos.name || (pos.type === 'stock' ? 'Акція' : 'Крипто')}</div>
                    </td>
                    <td className="text-right py-3 px-3 text-slate-400">{formatNumber(calc.totalBuyQty, 4)}</td>
                    <td className="text-right py-3 px-3 text-slate-400">{formatMoney(calc.avgPrice)}</td>
                    <td className="text-right py-3 px-3 text-slate-400">{formatMoney(calc.totalBuyCost)}</td>
                    <td className="text-right py-3 px-3 text-slate-400">{formatMoney(calc.totalSellProceeds)}</td>
                    <td className={`text-right py-3 px-3 font-medium ${pnlColor(calc.realizedPnl)}`}>{formatMoney(calc.realizedPnl)}</td>
                    <td className={`text-right py-3 px-3 font-medium ${pnlColor(calc.realizedPnlPercent)}`}>{formatPercent(calc.realizedPnlPercent)}</td>
                    <td className="text-right py-3 px-3 whitespace-nowrap">
                      <button
                        onClick={() => {
                          setShowAddTrade(pos.id)
                          setValueTrade('date', new Date().toISOString().split('T')[0])
                        }}
                        className="text-blue-400 hover:text-blue-300 text-xs mr-2 transition-colors"
                      >
                        +Угода
                      </button>
                      <button onClick={() => handleDeletePosition(pos.id)} className="text-red-400 hover:text-red-300 text-xs transition-colors">
                        Вид.
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-white/15 bg-white/5 font-medium">
                  <td className="py-3 px-3 text-white">Всього продано</td>
                  <td colSpan={4} />
                  <td className={`text-right py-3 px-3 ${pnlColor(soldTotalRealizedPnl)}`}>{formatMoney(soldTotalRealizedPnl)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Add Trade Modal */}
      {showAddTrade && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
             onClick={(e) => { if (e.target === e.currentTarget) { setShowAddTrade(null); resetTrade() } }}>
          <form onSubmit={handleSubmitTrade(onAddTrade)} className="glass-modal rounded-xl p-6 w-full max-w-md">
            <h3 className="font-semibold text-white mb-4">Нова угода</h3>
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
                <input type="number" step="any" {...registerTrade('price')} className="glass-input w-full" placeholder="0.00" />
                {tradeErrors.price && <p className="text-red-400 text-xs mt-1">{tradeErrors.price.message}</p>}
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Кількість</label>
                <input type="number" step="any" {...registerTrade('quantity')} className="glass-input w-full" placeholder="0" />
                {tradeErrors.quantity && <p className="text-red-400 text-xs mt-1">{tradeErrors.quantity.message}</p>}
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-sm text-slate-300 mb-1">Нотатки</label>
              <input type="text" {...registerTrade('notes')} className="glass-input w-full" placeholder="Необов'язково" />
            </div>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => { setShowAddTrade(null); resetTrade() }} className="btn btn-ghost">
                Скасувати
              </button>
              <button type="submit" disabled={addTrade.isPending} className="btn btn-primary">
                Додати угоду
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Cash Adjustment Modal */}
      {showCashModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
             onClick={(e) => { if (e.target === e.currentTarget) setShowCashModal(false) }}>
          <form onSubmit={handleSubmitCash(onCashAdjustment)} className="glass-modal rounded-xl p-6 w-full max-w-md">
            <h3 className="font-semibold text-white mb-4">Коригування готівки</h3>
            <div className="mb-3">
              <label className="block text-sm text-slate-300 mb-1">Дата</label>
              <input type="date" {...registerCash('date')} className="glass-input w-full" />
              {cashErrors.date && <p className="text-red-400 text-xs mt-1">{cashErrors.date.message}</p>}
            </div>
            <div className="mb-3">
              <label className="block text-sm text-slate-300 mb-1">Поточний баланс</label>
              <div className="bg-white/5 rounded-lg px-3 py-2 text-lg font-semibold text-white">
                {formatMoney(cashBalance)}
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-sm text-slate-300 mb-1">Новий баланс</label>
              <input type="number" step="any" {...registerCash('newBalance')} className="glass-input w-full" placeholder="0.00" />
              {cashErrors.newBalance && <p className="text-red-400 text-xs mt-1">{cashErrors.newBalance.message}</p>}
            </div>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setShowCashModal(false)} className="btn btn-ghost">
                Скасувати
              </button>
              <button type="submit" disabled={cashAdjustment.isPending} className="btn btn-primary">
                Зберегти
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
