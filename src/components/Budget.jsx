import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatMoney } from '../lib/formatters'

const CURRENCY_ICONS = { UAH: '🇺🇦', USD: '🇺🇸', EUR: '🇪🇺' }

export default function Budget() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ label: '', currency: 'UAH', amount: '' })
  const [error, setError] = useState(null)

  useEffect(() => { fetchBudget() }, [])

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
    </div>
  )
}
