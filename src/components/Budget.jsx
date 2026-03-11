import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatMoney } from '../lib/formatters'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

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

export default function Budget() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ label: '', currency: 'UAH', amount: '' })
  const [error, setError] = useState(null)

  const [cashflow, setCashflow] = useState([])
  const [showCashflowForm, setShowCashflowForm] = useState(false)
  const [editingCashflowId, setEditingCashflowId] = useState(null)
  const [cfForm, setCfForm] = useState({ month: currentMonth(), income: '', expenses: '', investments: '', currency: 'UAH' })
  const [viewMode, setViewMode] = useState('chart')
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [activeSeries, setActiveSeries] = useState(null)

  useEffect(() => { fetchBudget(); fetchCashflow() }, [])

  async function fetchBudget() {
    setLoading(true)
    const { data, error: fetchError } = await supabase.from('budget').select('*').order('updated_at', { ascending: true })
    if (fetchError) { setError(fetchError.message); setLoading(false); return }
    setItems(data || [])
    setLoading(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    const payload = { label: form.label, currency: form.currency, amount: Number(form.amount), updated_at: new Date().toISOString() }
    let result
    if (editingId) {
      result = await supabase.from('budget').update(payload).eq('id', editingId)
    } else {
      result = await supabase.from('budget').insert(payload)
    }
    if (result.error) {
      setError(result.error.message)
      return
    }
    resetForm()
    fetchBudget()
  }

  async function handleDelete(id) {
    if (!confirm('Видалити цей рахунок?')) return
    await supabase.from('budget').delete().eq('id', id)
    fetchBudget()
  }

  async function handleUpdateAmount(item) {
    const newAmount = prompt(`Нова сума для "${item.label}" (${item.currency}):`, item.amount)
    if (newAmount === null) return
    const num = Number(newAmount)
    if (isNaN(num)) return
    await supabase.from('budget').update({ amount: num, updated_at: new Date().toISOString() }).eq('id', item.id)
    fetchBudget()
  }

  function startEdit(item) {
    setEditingId(item.id)
    setForm({ label: item.label, currency: item.currency, amount: String(item.amount) })
    setShowForm(true)
  }

  function resetForm() {
    setForm({ label: '', currency: 'UAH', amount: '' })
    setShowForm(false)
    setEditingId(null)
  }

  async function fetchCashflow() {
    const { data } = await supabase.from('monthly_cashflow').select('*').order('month', { ascending: false })
    setCashflow(data || [])
  }

  async function handleCashflowSubmit(e) {
    e.preventDefault()
    const payload = { month: cfForm.month, income: Number(cfForm.income), expenses: Number(cfForm.expenses), investments: Number(cfForm.investments), currency: cfForm.currency, updated_at: new Date().toISOString() }
    if (editingCashflowId) {
      await supabase.from('monthly_cashflow').update(payload).eq('id', editingCashflowId)
    } else {
      await supabase.from('monthly_cashflow').insert(payload)
    }
    resetCashflowForm()
    fetchCashflow()
  }

  async function handleCashflowDelete(id) {
    if (!confirm('Видалити цей запис?')) return
    await supabase.from('monthly_cashflow').delete().eq('id', id)
    fetchCashflow()
  }

  function startEditCashflow(entry) {
    setEditingCashflowId(entry.id)
    setCfForm({ month: entry.month, income: String(entry.income), expenses: String(entry.expenses), investments: String(entry.investments), currency: entry.currency })
    setShowCashflowForm(true)
  }

  function resetCashflowForm() {
    setCfForm({ month: currentMonth(), income: '', expenses: '', investments: '', currency: 'UAH' })
    setShowCashflowForm(false)
    setEditingCashflowId(null)
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

  if (loading) return <div className="text-gray-500">Завантаження...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Бюджет</h2>
        <button
          onClick={() => { setShowForm(true); setEditingId(null); setForm({ label: '', currency: 'UAH', amount: '' }) }}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          + Додати рахунок
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 mb-4 flex items-center justify-between">
          <span>❌ {error}</span>
          <button onClick={() => setError(null)} className="text-red-600 hover:text-red-800 text-sm">✕</button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="text-sm text-gray-500 mb-1">Загальний бюджет (в USD)</div>
        <div className="text-2xl font-bold text-gray-800">{formatMoney(totalUsd)}</div>
        <div className="flex gap-4 mt-2 text-sm text-gray-600">
          {Object.entries(totals).map(([cur, total]) => (
            total > 0 && <span key={cur}>{CURRENCY_ICONS[cur]} {formatMoney(total, cur)}</span>
          ))}
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <h3 className="font-semibold text-gray-700 mb-3">{editingId ? 'Редагувати' : 'Новий рахунок'}</h3>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-sm text-gray-600 mb-1">Назва</label>
              <input
                type="text"
                required
                value={form.label}
                onChange={e => setForm({ ...form, label: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Монобанк"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Валюта</label>
              <select
                value={form.currency}
                onChange={e => setForm({ ...form, currency: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="UAH">UAH</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Сума</label>
              <input
                type="number"
                step="any"
                required
                value={form.amount}
                onChange={e => setForm({ ...form, amount: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
              />
            </div>
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
              {editingId ? 'Зберегти' : 'Додати'}
            </button>
            <button type="button" onClick={resetForm} className="text-gray-500 px-3 py-2 text-sm">Скасувати</button>
          </div>
        </form>
      )}

      {Object.entries(grouped).map(([currency, list]) =>
        list.length > 0 && (
          <div key={currency} className="mb-6">
            <h3 className="text-lg font-semibold text-gray-700 mb-3">
              {CURRENCY_ICONS[currency]} {currency}
              <span className="text-sm font-normal text-gray-500 ml-2">Всього: {formatMoney(totals[currency], currency)}</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {list.map(item => (
                <div key={item.id} className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium text-gray-800">{item.label}</div>
                      <div className="text-xl font-bold text-gray-800 mt-1 cursor-pointer hover:text-blue-600" onClick={() => handleUpdateAmount(item)}>
                        {formatMoney(item.amount, item.currency)}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => startEdit(item)} className="text-gray-400 hover:text-blue-600 text-xs px-1">Ред.</button>
                      <button onClick={() => handleDelete(item.id)} className="text-gray-400 hover:text-red-600 text-xs px-1">Вид.</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      )}

      {items.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg mb-2">Немає рахунків</p>
          <p className="text-sm">Додайте рахунки для відстеження готівки та балансів</p>
        </div>
      )}

      <hr className="border-gray-200 my-8" />

      {/* Cashflow section header */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xl font-bold text-gray-800">Статистика балансу</h2>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('chart')}
              title="Графік"
              className={`p-1.5 rounded-md transition-all ${viewMode === 'chart' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}
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
              className={`p-1.5 rounded-md transition-all ${viewMode === 'table' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="1" y="3" width="16" height="2.5" rx="1" fill="currentColor"/>
                <rect x="1" y="7.5" width="16" height="2.5" rx="1" fill="currentColor"/>
                <rect x="1" y="12" width="16" height="2.5" rx="1" fill="currentColor"/>
              </svg>
            </button>
          </div>
          <button
            onClick={() => { setShowCashflowForm(true); setEditingCashflowId(null); setCfForm({ month: currentMonth(), income: '', expenses: '', investments: '', currency: 'UAH' }) }}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            + Додати місяць
          </button>
        </div>
      </div>

      {/* Year selector */}
      <div className="flex items-center gap-2 text-sm text-gray-600 mb-4">
        <button onClick={() => setSelectedYear(y => y - 1)} className="hover:text-gray-900 px-1">◂</button>
        <span className="font-medium w-10 text-center">{selectedYear}</span>
        <button onClick={() => setSelectedYear(y => y + 1)} disabled={selectedYear >= new Date().getFullYear()} className="hover:text-gray-900 px-1 disabled:opacity-30">▸</button>
      </div>

      {showCashflowForm && (
        <form onSubmit={handleCashflowSubmit} className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <h3 className="font-semibold text-gray-700 mb-3">{editingCashflowId ? 'Редагувати місяць' : 'Новий запис'}</h3>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Місяць</label>
              <input
                type="month"
                required
                value={cfForm.month}
                onChange={e => setCfForm({ ...cfForm, month: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Валюта</label>
              <select
                value={cfForm.currency}
                onChange={e => setCfForm({ ...cfForm, currency: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="UAH">UAH</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Доходи</label>
              <input
                type="number"
                step="any"
                required
                value={cfForm.income}
                onChange={e => setCfForm({ ...cfForm, income: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Витрати</label>
              <input
                type="number"
                step="any"
                required
                value={cfForm.expenses}
                onChange={e => setCfForm({ ...cfForm, expenses: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Інвестиції</label>
              <input
                type="number"
                step="any"
                required
                value={cfForm.investments}
                onChange={e => setCfForm({ ...cfForm, investments: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
              />
            </div>
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
              {editingCashflowId ? 'Зберегти' : 'Додати'}
            </button>
            <button type="button" onClick={resetCashflowForm} className="text-gray-500 px-3 py-2 text-sm">Скасувати</button>
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
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              {/* Summary pills */}
              {(() => {
                const pills = [
                  { key: 'Доходи',    bg: 'bg-emerald-50', ring: 'ring-[#10B981]', dot: 'bg-[#10B981]', value: totalIncome },
                  { key: 'Витрати',   bg: 'bg-orange-50',  ring: 'ring-[#F97316]', dot: 'bg-[#F97316]', value: totalExpenses },
                  { key: 'Інвестиції',bg: 'bg-violet-50',  ring: 'ring-[#8B5CF6]', dot: 'bg-[#8B5CF6]', value: totalInvestments },
                ]
                return (
                  <div className="flex flex-wrap gap-3 mb-5">
                    {pills.map(p => {
                      const isActive = activeSeries === null || activeSeries === p.key
                      return (
                        <button
                          key={p.key}
                          onClick={() => setActiveSeries(s => s === p.key ? null : p.key)}
                          className={`flex items-center gap-2 ${p.bg} rounded-lg px-3 py-2 transition-all cursor-pointer select-none
                            ${activeSeries === p.key ? `ring-2 ${p.ring}` : ''}
                            ${!isActive ? 'opacity-35' : 'opacity-100'}`}
                        >
                          <span className={`w-2.5 h-2.5 rounded-full ${p.dot} inline-block`}></span>
                          <span className="text-xs text-gray-500">{p.key}</span>
                          <span className="text-sm font-semibold text-gray-800">{formatMoney(p.value, activeCurrency)}</span>
                        </button>
                      )
                    })}
                  </div>
                )
              })()}
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis width={60} tick={{ fontSize: 11 }} tickFormatter={v => v === 0 ? '0' : `${(v / 1000).toFixed(0)}к`} />
                  <Tooltip formatter={(v, name) => [formatMoney(v, activeCurrency), name]} />
                  <Legend />
                  <Bar dataKey="Доходи"     fill="#10B981" radius={[3,3,0,0]} maxBarSize={24} opacity={activeSeries === null || activeSeries === 'Доходи'     ? 1 : 0.15} />
                  <Bar dataKey="Витрати"    fill="#F97316" radius={[3,3,0,0]} maxBarSize={24} opacity={activeSeries === null || activeSeries === 'Витрати'    ? 1 : 0.15} />
                  <Bar dataKey="Інвестиції" fill="#8B5CF6" radius={[3,3,0,0]} maxBarSize={24} opacity={activeSeries === null || activeSeries === 'Інвестиції' ? 1 : 0.15} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )
        }

        // Table view
        return (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Місяць</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Доходи</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Витрати</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Дельта</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Інвестиції</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {yearRows.map(row => {
                  const delta = row.income - row.expenses
                  const hasData = row.id !== null
                  return (
                    <tr key={row.monthKey} className={`hover:bg-gray-50 ${!hasData ? 'opacity-40' : ''}`}>
                      <td className="px-4 py-3 font-medium text-gray-800">
                        {row.name}
                        {hasData && <span className="text-gray-400 text-xs ml-1">{row.currency}</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-[#10B981]">
                        {hasData ? formatMoney(row.income, row.currency) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-[#F97316]">
                        {hasData ? formatMoney(row.expenses, row.currency) : '—'}
                      </td>
                      <td className={`px-4 py-3 text-right font-medium ${!hasData ? 'text-gray-400' : delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-500' : 'text-gray-500'}`}>
                        {hasData ? (delta >= 0 ? '+' : '') + formatMoney(delta, row.currency) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-[#8B5CF6]">
                        {hasData ? formatMoney(row.investments, row.currency) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {hasData ? (
                          <>
                            <button onClick={() => startEditCashflow(cashflow.find(e => e.id === row.id))} className="text-gray-400 hover:text-blue-600 text-xs px-1">Ред.</button>
                            <button onClick={() => handleCashflowDelete(row.id)} className="text-gray-400 hover:text-red-600 text-xs px-1">Вид.</button>
                          </>
                        ) : ''}
                      </td>
                    </tr>
                  )
                })}
                {/* Dashed separator */}
                <tr><td colSpan={6} className="px-0 py-0"><div className="border-t-2 border-dashed border-gray-300 mx-4"></div></td></tr>
                {/* Average row */}
                <tr className="font-semibold bg-gray-50">
                  <td className="px-4 py-3 text-gray-700">Середнє</td>
                  <td className="px-4 py-3 text-right text-[#10B981]">{dataRows.length ? formatMoney(avgIncome, activeCurrency) : '—'}</td>
                  <td className="px-4 py-3 text-right text-[#F97316]">{dataRows.length ? formatMoney(avgExpenses, activeCurrency) : '—'}</td>
                  <td className={`px-4 py-3 text-right ${avgIncome - avgExpenses >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {dataRows.length ? (avgIncome - avgExpenses >= 0 ? '+' : '') + formatMoney(avgIncome - avgExpenses, activeCurrency) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-[#8B5CF6]">{dataRows.length ? formatMoney(avgInvestments, activeCurrency) : '—'}</td>
                  <td></td>
                </tr>
                {/* Total row */}
                <tr className="font-semibold bg-gray-50 border-t border-gray-200">
                  <td className="px-4 py-3 text-gray-700">Всього</td>
                  <td className="px-4 py-3 text-right text-[#10B981]">{dataRows.length ? formatMoney(totalIncome, activeCurrency) : '—'}</td>
                  <td className="px-4 py-3 text-right text-[#F97316]">{dataRows.length ? formatMoney(totalExpenses, activeCurrency) : '—'}</td>
                  <td className={`px-4 py-3 text-right ${totalIncome - totalExpenses >= 0 ? 'text-green-600' : 'text-red-500'}`}>
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
