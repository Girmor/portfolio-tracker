import { useState, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { formatMoney } from '../lib/formatters'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  useBudgetQuery,
  useCashflowQuery,
  useCreateBudgetItemMutation,
  useUpdateBudgetItemMutation,
  useDeleteBudgetItemMutation,
  useCreateCashflowMutation,
  useUpdateCashflowMutation,
  useDeleteCashflowMutation,
} from '../hooks/useBudgetQuery'

const CURRENCY_ICONS = { UAH: '🇺🇦', USD: '🇺🇸', EUR: '🇪🇺' }
const MONTHS_UK = ['Січень','Лютий','Березень','Квітень','Травень','Червень',
                   'Липень','Серпень','Вересень','Жовтень','Листопад','Грудень']

function currentMonth() { return new Date().toISOString().slice(0, 7) }

function monthLabel(monthKey) {
  const [year, month] = monthKey.split('-')
  return `${MONTHS_UK[parseInt(month, 10) - 1]} ${year}`
}

function addMonths(monthKey, delta) {
  const [year, month] = monthKey.split('-').map(Number)
  const d = new Date(year, month - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function buildYearRows(cashflow, year) {
  return MONTHS_UK.map((name, i) => {
    const monthKey = `${year}-${String(i + 1).padStart(2, '0')}`
    const entry = cashflow.find(r => r.month === monthKey)
    return {
      monthKey, name,
      income: entry?.income ?? 0,
      expenses: entry?.expenses ?? 0,
      investments: entry?.investments ?? 0,
      currency: entry?.currency ?? 'UAH',
      id: entry?.id ?? null,
    }
  })
}

const budgetSchema = z.object({
  label: z.string().min(1, "Назва обов'язкова"),
  currency: z.enum(['UAH', 'USD', 'EUR']),
  amount: z.coerce.number().min(0, 'Сума має бути >= 0'),
  type: z.enum(['asset', 'liability']),
})

const cashflowSchema = z.object({
  month: z.string().min(1, 'Місяць обов\'язковий'),
  currency: z.enum(['UAH', 'USD', 'EUR']),
  income: z.coerce.number().min(0),
  expenses: z.coerce.number().min(0),
  investments: z.coerce.number().min(0),
})

const tooltipStyle = {
  backgroundColor: '#1e293b',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 8,
  color: '#e2e8f0',
}
const tooltipItemStyle = { color: '#e2e8f0' }
const tooltipLabelStyle = { color: '#94a3b8' }

export default function Budget() {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [showCashflowForm, setShowCashflowForm] = useState(false)
  const [editingCashflowId, setEditingCashflowId] = useState(null)
  const [viewMode, setViewMode] = useState('chart')
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [activeSeries, setActiveSeries] = useState(null)
  const [selectedMonth, setSelectedMonth] = useState(currentMonth)

  const { data: items = [], isLoading: budgetLoading } = useBudgetQuery()
  const { data: cashflow = [], isLoading: cashflowLoading } = useCashflowQuery()

  const createBudget = useCreateBudgetItemMutation()
  const updateBudget = useUpdateBudgetItemMutation()
  const deleteBudget = useDeleteBudgetItemMutation()
  const createCashflow = useCreateCashflowMutation()
  const updateCashflow = useUpdateCashflowMutation()
  const deleteCashflow = useDeleteCashflowMutation()

  const { register: rBudget, handleSubmit: hsBudget, reset: rsBudget, watch: wBudget, setValue: svBudget, formState: { errors: eBudget } } = useForm({
    resolver: zodResolver(budgetSchema),
    defaultValues: { label: '', currency: 'UAH', amount: '', type: 'asset' },
  })

  const { register: rCashflow, handleSubmit: hsCashflow, reset: rsCashflow, formState: { errors: eCashflow } } = useForm({
    resolver: zodResolver(cashflowSchema),
    defaultValues: { month: currentMonth(), currency: 'UAH', income: '', expenses: '', investments: '' },
  })

  async function onBudgetSubmit(values) {
    try {
      const payload = { ...values, month: selectedMonth, updated_at: new Date().toISOString() }
      if (editingId) {
        await updateBudget.mutateAsync({ id: editingId, data: payload })
        toast.success('Рахунок оновлено')
      } else {
        await createBudget.mutateAsync(payload)
        toast.success('Рахунок додано')
      }
      rsBudget({ label: '', currency: 'UAH', amount: '', type: 'asset' })
      setShowForm(false)
      setEditingId(null)
    } catch (err) {
      toast.error(err.message)
    }
  }

  async function handleDelete(id) {
    if (!confirm('Видалити цей рахунок?')) return
    try {
      await deleteBudget.mutateAsync(id)
      toast.success('Рахунок видалено')
    } catch (err) {
      toast.error(err.message)
    }
  }

  async function handleUpdateAmount(item) {
    const newAmount = prompt(`Нова сума для "${item.label}" (${item.currency}):`, item.amount)
    if (newAmount === null) return
    const num = Number(newAmount)
    if (isNaN(num)) return
    try {
      await updateBudget.mutateAsync({ id: item.id, data: { amount: num, updated_at: new Date().toISOString() } })
      toast.success('Суму оновлено')
    } catch (err) {
      toast.error(err.message)
    }
  }

  function startEditBudget(item) {
    setEditingId(item.id)
    rsBudget({ label: item.label, currency: item.currency, amount: String(item.amount), type: item.type || 'asset' })
    setShowForm(true)
  }

  async function onCashflowSubmit(values) {
    try {
      const payload = { ...values, updated_at: new Date().toISOString() }
      if (editingCashflowId) {
        await updateCashflow.mutateAsync({ id: editingCashflowId, data: payload })
        toast.success('Місяць оновлено')
      } else {
        await createCashflow.mutateAsync(payload)
        toast.success('Місяць додано')
      }
      rsCashflow({ month: currentMonth(), currency: 'UAH', income: '', expenses: '', investments: '' })
      setShowCashflowForm(false)
      setEditingCashflowId(null)
    } catch (err) {
      toast.error(err.message)
    }
  }

  async function handleCashflowDelete(id) {
    if (!confirm('Видалити цей запис?')) return
    try {
      await deleteCashflow.mutateAsync(id)
      toast.success('Запис видалено')
    } catch (err) {
      toast.error(err.message)
    }
  }

  function startEditCashflow(entry) {
    setEditingCashflowId(entry.id)
    rsCashflow({ month: entry.month, income: String(entry.income), expenses: String(entry.expenses), investments: String(entry.investments), currency: entry.currency })
    setShowCashflowForm(true)
  }

  // Filter budget items to selected month
  const filteredItems = items.filter(i => i.month === selectedMonth)
  const assets = filteredItems.filter(i => (i.type || 'asset') === 'asset')
  const liabilities = filteredItems.filter(i => i.type === 'liability')

  function groupByCurrency(list) {
    const g = { UAH: [], USD: [], EUR: [] }
    list.forEach(item => { g[item.currency] = [...(g[item.currency] || []), item] })
    return g
  }
  function sumByCurrency(list) {
    const t = {}
    list.forEach(i => { t[i.currency] = (t[i.currency] || 0) + Number(i.amount) })
    return t
  }
  function toUsd(t) {
    return (t.USD || 0) + (t.EUR || 0) * 1.08 + (t.UAH || 0) / 41.5
  }

  const assetGrouped = groupByCurrency(assets)
  const liabilityGrouped = groupByCurrency(liabilities)
  const assetTotals = sumByCurrency(assets)
  const liabilityTotals = sumByCurrency(liabilities)
  const assetUsd = toUsd(assetTotals)
  const liabilityUsd = toUsd(liabilityTotals)
  const totalUsdForSelectedMonth = assetUsd - liabilityUsd

  // Monthly totals for sparkline (all items, not filtered), assets minus liabilities
  const monthlyTotals = useMemo(() => {
    const map = new Map()
    for (const item of items) {
      const acc = map.get(item.month) || { UAH: 0, USD: 0, EUR: 0 }
      const sign = item.type === 'liability' ? -1 : 1
      acc[item.currency] = (acc[item.currency] || 0) + sign * Number(item.amount)
      map.set(item.month, acc)
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, t]) => ({
        month,
        total: (t.USD || 0) + (t.EUR || 0) * 1.08 + (t.UAH || 0) / 41.5,
      }))
  }, [items])

  if (budgetLoading) return <div className="text-slate-400 animate-pulse">Завантаження...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Бюджет</h2>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowForm(true); setEditingId(null); rsBudget({ label: '', currency: 'UAH', amount: '', type: 'asset' }) }}
            className="btn btn-primary"
          >
            + Рахунок
          </button>
          <button
            onClick={() => { setShowForm(true); setEditingId(null); rsBudget({ label: '', currency: 'UAH', amount: '', type: 'liability' }) }}
            className="btn btn-ghost border border-red-500/40 text-red-400 hover:bg-red-500/10"
          >
            + Зобов'язання
          </button>
        </div>
      </div>

      {/* Total card with sparkline */}
      <div className="glass-card rounded-xl p-5 mb-4">
        <div className="text-xs text-slate-400 mb-1">Загальний бюджет (в USD)</div>
        <div className={`text-2xl font-bold ${totalUsdForSelectedMonth >= 0 ? 'text-white' : 'text-red-400'}`}>
          {formatMoney(totalUsdForSelectedMonth)}
        </div>
        <div className="flex gap-4 mt-1 text-xs">
          {assetUsd > 0 && (
            <span className="text-slate-400">
              Активи: <span className="text-emerald-400">{formatMoney(assetUsd)}</span>
            </span>
          )}
          {liabilityUsd > 0 && (
            <span className="text-slate-400">
              Зобов'язання: <span className="text-red-400">−{formatMoney(liabilityUsd)}</span>
            </span>
          )}
        </div>
        {monthlyTotals.length >= 2 && (
          <div className="mt-3 [&_.recharts-surface]:bg-transparent [&_.recharts-wrapper]:bg-transparent" style={{ height: 60 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyTotals} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                <Tooltip
                  formatter={(v) => [formatMoney(v), 'USD']}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.month ? monthLabel(payload[0].payload.month) : ''}
                  contentStyle={tooltipStyle}
                  itemStyle={tooltipItemStyle}
                  labelStyle={tooltipLabelStyle}
                  wrapperStyle={{ outline: 'none' }}
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                />
                <Bar dataKey="total" radius={[2, 2, 0, 0]} maxBarSize={16}>
                  {monthlyTotals.map((entry, i) => (
                    <Cell key={i} fill={entry.month === selectedMonth ? '#60a5fa' : 'rgba(96,165,250,0.35)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Month navigator */}
      <div className="flex items-center gap-2 text-sm text-slate-400 mb-4">
        <button
          onClick={() => setSelectedMonth(m => addMonths(m, -1))}
          className="hover:text-slate-200 px-1 transition-colors"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="font-medium text-slate-200 w-36 text-center">{monthLabel(selectedMonth)}</span>
        <button
          onClick={() => setSelectedMonth(m => addMonths(m, 1))}
          disabled={selectedMonth >= currentMonth()}
          className="hover:text-slate-200 px-1 disabled:opacity-30 transition-colors"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {showForm && (
        <form onSubmit={hsBudget(onBudgetSubmit)} className="glass-card rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-200">
              {editingId ? 'Редагувати' : (wBudget('type') === 'liability' ? 'Нове зобов\'язання' : 'Новий рахунок')}
            </h3>
            <div className="flex bg-white/8 rounded-lg p-0.5">
              <button type="button"
                onClick={() => svBudget('type', 'asset')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${wBudget('type') === 'asset' ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-400 hover:text-slate-200'}`}
              >Актив</button>
              <button type="button"
                onClick={() => svBudget('type', 'liability')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${wBudget('type') === 'liability' ? 'bg-red-500/20 text-red-400' : 'text-slate-400 hover:text-slate-200'}`}
              >Зобов'язання</button>
            </div>
          </div>
          <div className="text-xs text-slate-400 mb-3">Місяць: {monthLabel(selectedMonth)}</div>
          <div className="flex gap-3 items-start">
            <div className="flex-1">
              <label className="block text-sm text-slate-300 mb-1">Назва</label>
              <input
                {...rBudget('label')}
                className="glass-input w-full"
                placeholder="Монобанк"
              />
              {eBudget.label && <p className="text-red-400 text-xs mt-1">{eBudget.label.message}</p>}
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1">Валюта</label>
              <select {...rBudget('currency')} className="glass-input">
                <option value="UAH">UAH</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1">Сума</label>
              <input
                type="number"
                step="any"
                {...rBudget('amount')}
                className="glass-input w-32"
                placeholder="0.00"
              />
              {eBudget.amount && <p className="text-red-400 text-xs mt-1">{eBudget.amount.message}</p>}
            </div>
            <div className="flex gap-2 pt-6">
              <button type="submit" disabled={createBudget.isPending || updateBudget.isPending} className="btn btn-primary">
                {editingId ? 'Зберегти' : 'Додати'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setEditingId(null) }} className="btn btn-ghost">Скасувати</button>
            </div>
          </div>
        </form>
      )}

      {/* Assets section */}
      {assets.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-semibold text-emerald-400 uppercase tracking-wide">Активи</h3>
            <span className="text-xs text-slate-500">{formatMoney(assetUsd)}</span>
          </div>
          {Object.entries(assetGrouped).map(([currency, list]) =>
            list.length > 0 && (
              <div key={currency} className="mb-4">
                <div className="text-xs text-slate-500 mb-2">
                  {CURRENCY_ICONS[currency]} {currency} — {formatMoney(assetTotals[currency] || 0, currency)}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
                  {list.map(item => (
                    <div key={item.id} className="glass-card rounded-xl p-3 hover:bg-white/[0.09] transition-colors">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="text-sm text-slate-200">{item.label}</div>
                          <div
                            className="text-base font-bold text-white mt-0.5 cursor-pointer hover:text-blue-400 transition-colors"
                            onClick={() => handleUpdateAmount(item)}
                          >
                            {formatMoney(item.amount, item.currency)}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <button onClick={() => startEditBudget(item)} className="text-slate-500 hover:text-blue-400 text-xs px-1 transition-colors">Ред.</button>
                          <button onClick={() => handleDelete(item.id)} className="text-slate-500 hover:text-red-400 text-xs px-1 transition-colors">Вид.</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      )}

      {/* Liabilities section */}
      {liabilities.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-semibold text-red-400 uppercase tracking-wide">Зобов'язання</h3>
            <span className="text-xs text-slate-500">−{formatMoney(liabilityUsd)}</span>
          </div>
          {Object.entries(liabilityGrouped).map(([currency, list]) =>
            list.length > 0 && (
              <div key={currency} className="mb-4">
                <div className="text-xs text-slate-500 mb-2">
                  {CURRENCY_ICONS[currency]} {currency} — {formatMoney(liabilityTotals[currency] || 0, currency)}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
                  {list.map(item => (
                    <div key={item.id} className="glass-card rounded-xl p-3 border border-red-500/20 hover:bg-red-500/5 transition-colors">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="text-sm text-slate-200">{item.label}</div>
                          <div
                            className="text-base font-bold text-red-400 mt-0.5 cursor-pointer hover:text-red-300 transition-colors"
                            onClick={() => handleUpdateAmount(item)}
                          >
                            −{formatMoney(item.amount, item.currency)}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <button onClick={() => startEditBudget(item)} className="text-slate-500 hover:text-blue-400 text-xs px-1 transition-colors">Ред.</button>
                          <button onClick={() => handleDelete(item.id)} className="text-slate-500 hover:text-red-400 text-xs px-1 transition-colors">Вид.</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      )}

      {filteredItems.length === 0 && (
        <div className="text-center py-10 text-slate-400">
          <p className="text-base mb-1">Немає записів за {monthLabel(selectedMonth)}</p>
          <p className="text-sm">Додайте рахунки або зобов'язання</p>
        </div>
      )}

      <hr className="border-white/10 my-8" />

      {/* Cashflow section */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xl font-bold text-white">Статистика балансу</h2>
        <div className="flex items-center gap-3">
          <div className="flex bg-white/8 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('chart')}
              title="Графік"
              className={`p-1.5 rounded-md transition-all ${viewMode === 'chart' ? 'bg-white/15 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="1" y="10" width="3" height="7" rx="1" fill="currentColor"/>
                <rect x="6" y="6" width="3" height="11" rx="1" fill="currentColor"/>
                <rect x="11" y="3" width="3" height="14" rx="1" fill="currentColor"/>
                <rect x="16" y="7" width="1" height="1" rx="0.5" fill="currentColor"/>
              </svg>
            </button>
            <button
              onClick={() => setViewMode('table')}
              title="Таблиця"
              className={`p-1.5 rounded-md transition-all ${viewMode === 'table' ? 'bg-white/15 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="1" y="3" width="16" height="2.5" rx="1" fill="currentColor"/>
                <rect x="1" y="7.5" width="16" height="2.5" rx="1" fill="currentColor"/>
                <rect x="1" y="12" width="16" height="2.5" rx="1" fill="currentColor"/>
              </svg>
            </button>
          </div>
          <button
            onClick={() => { setShowCashflowForm(true); setEditingCashflowId(null); rsCashflow({ month: currentMonth(), currency: 'UAH', income: '', expenses: '', investments: '' }) }}
            className="btn btn-primary"
          >
            + Додати місяць
          </button>
        </div>
      </div>

      {/* Year selector */}
      <div className="flex items-center gap-2 text-sm text-slate-400 mb-4">
        <button onClick={() => setSelectedYear(y => y - 1)} className="hover:text-slate-200 px-1 transition-colors"><ChevronLeft size={14} /></button>
        <span className="font-medium w-10 text-center text-slate-200">{selectedYear}</span>
        <button onClick={() => setSelectedYear(y => y + 1)} disabled={selectedYear >= new Date().getFullYear()} className="hover:text-slate-200 px-1 disabled:opacity-30 transition-colors"><ChevronRight size={14} /></button>
      </div>

      {showCashflowForm && (
        <form onSubmit={hsCashflow(onCashflowSubmit)} className="glass-card rounded-xl p-4 mb-6">
          <h3 className="font-semibold text-slate-200 mb-3">{editingCashflowId ? 'Редагувати місяць' : 'Новий запис'}</h3>
          <div className="flex flex-wrap gap-3 items-start">
            <div>
              <label className="block text-sm text-slate-300 mb-1">Місяць</label>
              <input type="month" {...rCashflow('month')} className="glass-input" />
              {eCashflow.month && <p className="text-red-400 text-xs mt-1">{eCashflow.month.message}</p>}
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1">Валюта</label>
              <select {...rCashflow('currency')} className="glass-input">
                <option value="UAH">UAH</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1">Доходи</label>
              <input type="number" step="any" {...rCashflow('income')} className="glass-input w-28" placeholder="0.00" />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1">Витрати</label>
              <input type="number" step="any" {...rCashflow('expenses')} className="glass-input w-28" placeholder="0.00" />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1">Інвестиції</label>
              <input type="number" step="any" {...rCashflow('investments')} className="glass-input w-28" placeholder="0.00" />
            </div>
            <div className="flex gap-2 pt-6">
              <button type="submit" disabled={createCashflow.isPending || updateCashflow.isPending} className="btn btn-primary">
                {editingCashflowId ? 'Зберегти' : 'Додати'}
              </button>
              <button type="button" onClick={() => { setShowCashflowForm(false); setEditingCashflowId(null) }} className="btn btn-ghost">Скасувати</button>
            </div>
          </div>
        </form>
      )}

      {(() => {
        const yearRows = buildYearRows(cashflow, selectedYear)
        const activeCurrency = yearRows.find(r => r.id)?.currency ?? 'UAH'
        const dataRows = yearRows.filter(r => r.id)
        const totalIncome = dataRows.reduce((s, r) => s + r.income, 0)
        const totalExpenses = dataRows.reduce((s, r) => s + r.expenses, 0)
        const totalInvestments = dataRows.reduce((s, r) => s + r.investments, 0)
        const avgIncome = dataRows.length ? totalIncome / dataRows.length : 0
        const avgExpenses = dataRows.length ? totalExpenses / dataRows.length : 0
        const avgInvestments = dataRows.length ? totalInvestments / dataRows.length : 0

        const chartData = yearRows.map(r => ({
          name: r.name.slice(0, 3),
          Доходи: r.income,
          Витрати: r.expenses,
          Інвестиції: r.investments,
        }))

        if (viewMode === 'chart') {
          return (
            <div className="glass-card rounded-xl p-5">
              {(() => {
                const pills = [
                  { key: 'Доходи',    bg: 'bg-emerald-500/10', ring: 'ring-[#10B981]', dot: 'bg-[#10B981]', value: totalIncome },
                  { key: 'Витрати',   bg: 'bg-orange-500/10',  ring: 'ring-[#F97316]', dot: 'bg-[#F97316]', value: totalExpenses },
                  { key: 'Інвестиції',bg: 'bg-violet-500/10',  ring: 'ring-[#8B5CF6]', dot: 'bg-[#8B5CF6]', value: totalInvestments },
                ]
                return (
                  <div className="flex flex-wrap gap-3 mb-5">
                    {pills.map(p => {
                      const isActive = activeSeries === null || activeSeries === p.key
                      return (
                        <button
                          key={p.key}
                          onClick={() => setActiveSeries(s => s === p.key ? null : p.key)}
                          className={`flex items-center gap-2 ${p.bg} rounded-lg px-3 py-2 transition-all cursor-pointer select-none border border-white/10
                            ${activeSeries === p.key ? `ring-2 ${p.ring}` : ''}
                            ${!isActive ? 'opacity-35' : 'opacity-100'}`}
                        >
                          <span className={`w-2.5 h-2.5 rounded-full ${p.dot} inline-block`}></span>
                          <span className="text-xs text-slate-400">{p.key}</span>
                          <span className="text-sm font-semibold text-white">{formatMoney(p.value, activeCurrency)}</span>
                        </button>
                      )
                    })}
                  </div>
                )
              })()}
              <div className="[&_.recharts-surface]:bg-transparent [&_.recharts-wrapper]:bg-transparent" style={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.07)" />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#94a3b8' }} />
                    <YAxis width={60} tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={v => v === 0 ? '0' : `${(v / 1000).toFixed(0)}к`} />
                    <Tooltip formatter={(v, name) => [formatMoney(v, activeCurrency), name]} contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelStyle={tooltipLabelStyle} />
                    <Legend wrapperStyle={{ color: '#94a3b8' }} />
                    <Bar dataKey="Доходи"     fill="#10b981" radius={[3,3,0,0]} maxBarSize={24} opacity={activeSeries === null || activeSeries === 'Доходи'     ? 1 : 0.15} />
                    <Bar dataKey="Витрати"    fill="#f97316" radius={[3,3,0,0]} maxBarSize={24} opacity={activeSeries === null || activeSeries === 'Витрати'    ? 1 : 0.15} />
                    <Bar dataKey="Інвестиції" fill="#8b5cf6" radius={[3,3,0,0]} maxBarSize={24} opacity={activeSeries === null || activeSeries === 'Інвестиції' ? 1 : 0.15} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )
        }

        return (
          <div className="glass-card rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-white/5 border-b border-white/10">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-slate-300">Місяць</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-300">Доходи</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-300">Витрати</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-300">Дельта</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-300">Інвестиції</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {yearRows.map(row => {
                  const delta = row.income - row.expenses
                  const hasData = row.id !== null
                  return (
                    <tr key={row.monthKey} className={`hover:bg-white/5 ${!hasData ? 'opacity-40' : ''}`}>
                      <td className="px-4 py-3 font-medium text-white">
                        {row.name}
                        {hasData && <span className="text-slate-500 text-xs ml-1">{row.currency}</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-[#10B981]">
                        {hasData ? formatMoney(row.income, row.currency) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-[#F97316]">
                        {hasData ? formatMoney(row.expenses, row.currency) : '—'}
                      </td>
                      <td className={`px-4 py-3 text-right font-medium ${!hasData ? 'text-slate-500' : delta > 0 ? 'text-green-400' : delta < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                        {hasData ? (delta >= 0 ? '+' : '') + formatMoney(delta, row.currency) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-[#8B5CF6]">
                        {hasData ? formatMoney(row.investments, row.currency) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {hasData ? (
                          <>
                            <button onClick={() => startEditCashflow(cashflow.find(e => e.id === row.id))} className="text-slate-500 hover:text-blue-400 text-xs px-1 transition-colors">Ред.</button>
                            <button onClick={() => handleCashflowDelete(row.id)} className="text-slate-500 hover:text-red-400 text-xs px-1 transition-colors">Вид.</button>
                          </>
                        ) : ''}
                      </td>
                    </tr>
                  )
                })}
                <tr><td colSpan={6} className="px-0 py-0"><div className="border-t-2 border-dashed border-white/10 mx-4"></div></td></tr>
                <tr className="font-semibold bg-white/5">
                  <td className="px-4 py-3 text-slate-300">Середнє</td>
                  <td className="px-4 py-3 text-right text-[#10B981]">{dataRows.length ? formatMoney(avgIncome, activeCurrency) : '—'}</td>
                  <td className="px-4 py-3 text-right text-[#F97316]">{dataRows.length ? formatMoney(avgExpenses, activeCurrency) : '—'}</td>
                  <td className={`px-4 py-3 text-right ${avgIncome - avgExpenses >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {dataRows.length ? (avgIncome - avgExpenses >= 0 ? '+' : '') + formatMoney(avgIncome - avgExpenses, activeCurrency) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-[#8B5CF6]">{dataRows.length ? formatMoney(avgInvestments, activeCurrency) : '—'}</td>
                  <td></td>
                </tr>
                <tr className="font-semibold bg-white/5 border-t border-white/10">
                  <td className="px-4 py-3 text-slate-300">Всього</td>
                  <td className="px-4 py-3 text-right text-[#10B981]">{dataRows.length ? formatMoney(totalIncome, activeCurrency) : '—'}</td>
                  <td className="px-4 py-3 text-right text-[#F97316]">{dataRows.length ? formatMoney(totalExpenses, activeCurrency) : '—'}</td>
                  <td className={`px-4 py-3 text-right ${totalIncome - totalExpenses >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {dataRows.length ? (totalIncome - totalExpenses >= 0 ? '+' : '') + formatMoney(totalIncome - totalExpenses, activeCurrency) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-[#8B5CF6]">{dataRows.length ? formatMoney(totalInvestments, activeCurrency) : '—'}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        )
      })()}
    </div>
  )
}
