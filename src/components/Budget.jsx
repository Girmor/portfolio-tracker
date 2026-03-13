import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { formatMoney } from '../lib/formatters'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
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
})

const cashflowSchema = z.object({
  month: z.string().min(1, 'Місяць обов\'язковий'),
  currency: z.enum(['UAH', 'USD', 'EUR']),
  income: z.coerce.number().min(0),
  expenses: z.coerce.number().min(0),
  investments: z.coerce.number().min(0),
})

const tooltipStyle = {
  background: '#1e293b',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 8,
  color: '#e2e8f0',
}

export default function Budget() {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [showCashflowForm, setShowCashflowForm] = useState(false)
  const [editingCashflowId, setEditingCashflowId] = useState(null)
  const [viewMode, setViewMode] = useState('chart')
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [activeSeries, setActiveSeries] = useState(null)

  const { data: items = [], isLoading: budgetLoading } = useBudgetQuery()
  const { data: cashflow = [], isLoading: cashflowLoading } = useCashflowQuery()

  const createBudget = useCreateBudgetItemMutation()
  const updateBudget = useUpdateBudgetItemMutation()
  const deleteBudget = useDeleteBudgetItemMutation()
  const createCashflow = useCreateCashflowMutation()
  const updateCashflow = useUpdateCashflowMutation()
  const deleteCashflow = useDeleteCashflowMutation()

  const { register: rBudget, handleSubmit: hsBudget, reset: rsBudget, formState: { errors: eBudget } } = useForm({
    resolver: zodResolver(budgetSchema),
    defaultValues: { label: '', currency: 'UAH', amount: '' },
  })

  const { register: rCashflow, handleSubmit: hsCashflow, reset: rsCashflow, formState: { errors: eCashflow } } = useForm({
    resolver: zodResolver(cashflowSchema),
    defaultValues: { month: currentMonth(), currency: 'UAH', income: '', expenses: '', investments: '' },
  })

  async function onBudgetSubmit(values) {
    try {
      const payload = { ...values, updated_at: new Date().toISOString() }
      if (editingId) {
        await updateBudget.mutateAsync({ id: editingId, data: payload })
        toast.success('Рахунок оновлено')
      } else {
        await createBudget.mutateAsync(payload)
        toast.success('Рахунок додано')
      }
      rsBudget({ label: '', currency: 'UAH', amount: '' })
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
    rsBudget({ label: item.label, currency: item.currency, amount: String(item.amount) })
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

  const grouped = { UAH: [], USD: [], EUR: [] }
  items.forEach(item => {
    if (!grouped[item.currency]) grouped[item.currency] = []
    grouped[item.currency].push(item)
  })

  const totals = {}
  for (const [cur, list] of Object.entries(grouped)) {
    totals[cur] = list.reduce((sum, i) => sum + Number(i.amount), 0)
  }

  const totalUsd = (totals.USD || 0) + (totals.EUR || 0) * 1.08 + (totals.UAH || 0) / 41.5

  if (budgetLoading) return <div className="text-slate-400 animate-pulse">Завантаження...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Бюджет</h2>
        <button
          onClick={() => { setShowForm(true); setEditingId(null); rsBudget({ label: '', currency: 'UAH', amount: '' }) }}
          className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          + Додати рахунок
        </button>
      </div>

      <div className="glass-card rounded-xl p-5 mb-6">
        <div className="text-sm text-slate-400 mb-1">Загальний бюджет (в USD)</div>
        <div className="text-2xl font-bold text-white">{formatMoney(totalUsd)}</div>
        <div className="flex gap-4 mt-2 text-sm text-slate-300">
          {Object.entries(totals).map(([cur, total]) => (
            total > 0 && <span key={cur}>{CURRENCY_ICONS[cur]} {formatMoney(total, cur)}</span>
          ))}
        </div>
      </div>

      {showForm && (
        <form onSubmit={hsBudget(onBudgetSubmit)} className="glass-card rounded-xl p-4 mb-6">
          <h3 className="font-semibold text-slate-200 mb-3">{editingId ? 'Редагувати' : 'Новий рахунок'}</h3>
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
              <button type="submit" disabled={createBudget.isPending || updateBudget.isPending} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
                {editingId ? 'Зберегти' : 'Додати'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setEditingId(null) }} className="text-slate-400 hover:text-slate-200 px-3 py-2 text-sm transition-colors">Скасувати</button>
            </div>
          </div>
        </form>
      )}

      {Object.entries(grouped).map(([currency, list]) =>
        list.length > 0 && (
          <div key={currency} className="mb-6">
            <h3 className="text-lg font-semibold text-slate-200 mb-3">
              {CURRENCY_ICONS[currency]} {currency}
              <span className="text-sm font-normal text-slate-400 ml-2">Всього: {formatMoney(totals[currency], currency)}</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {list.map(item => (
                <div key={item.id} className="glass-card rounded-xl p-4 hover:bg-white/[0.09] transition-colors">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium text-slate-200">{item.label}</div>
                      <div
                        className="text-xl font-bold text-white mt-1 cursor-pointer hover:text-blue-400 transition-colors"
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

      {items.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <p className="text-lg mb-2">Немає рахунків</p>
          <p className="text-sm">Додайте рахунки для відстеження готівки та балансів</p>
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
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            + Додати місяць
          </button>
        </div>
      </div>

      {/* Year selector */}
      <div className="flex items-center gap-2 text-sm text-slate-400 mb-4">
        <button onClick={() => setSelectedYear(y => y - 1)} className="hover:text-slate-200 px-1 transition-colors">◂</button>
        <span className="font-medium w-10 text-center text-slate-200">{selectedYear}</span>
        <button onClick={() => setSelectedYear(y => y + 1)} disabled={selectedYear >= new Date().getFullYear()} className="hover:text-slate-200 px-1 disabled:opacity-30 transition-colors">▸</button>
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
              <button type="submit" disabled={createCashflow.isPending || updateCashflow.isPending} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
                {editingCashflowId ? 'Зберегти' : 'Додати'}
              </button>
              <button type="button" onClick={() => { setShowCashflowForm(false); setEditingCashflowId(null) }} className="text-slate-400 hover:text-slate-200 px-3 py-2 text-sm transition-colors">Скасувати</button>
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
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.07)" />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#94a3b8' }} />
                  <YAxis width={60} tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={v => v === 0 ? '0' : `${(v / 1000).toFixed(0)}к`} />
                  <Tooltip formatter={(v, name) => [formatMoney(v, activeCurrency), name]} contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ color: '#94a3b8' }} />
                  <Bar dataKey="Доходи"     fill="#10B981" radius={[3,3,0,0]} maxBarSize={24} opacity={activeSeries === null || activeSeries === 'Доходи'     ? 1 : 0.15} />
                  <Bar dataKey="Витрати"    fill="#F97316" radius={[3,3,0,0]} maxBarSize={24} opacity={activeSeries === null || activeSeries === 'Витрати'    ? 1 : 0.15} />
                  <Bar dataKey="Інвестиції" fill="#8B5CF6" radius={[3,3,0,0]} maxBarSize={24} opacity={activeSeries === null || activeSeries === 'Інвестиції' ? 1 : 0.15} />
                </BarChart>
              </ResponsiveContainer>
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
