import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatMoney, formatDate } from '../lib/formatters'

export default function Dividends() {
  const [dividends, setDividends] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ticker: '', amount: '', date: '', notes: '' })

  useEffect(() => { fetchDividends() }, [])

  async function fetchDividends() {
    setLoading(true)
    const { data } = await supabase.from('dividends').select('*').order('date', { ascending: false })
    setDividends(data || [])
    setLoading(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    await supabase.from('dividends').insert({
      ticker: form.ticker.toUpperCase(),
      amount: Number(form.amount),
      date: form.date || new Date().toISOString().split('T')[0],
      notes: form.notes || null,
    })
    setForm({ ticker: '', amount: '', date: '', notes: '' })
    setShowForm(false)
    fetchDividends()
  }

  async function handleDelete(id) {
    if (!confirm('Видалити цей запис?')) return
    await supabase.from('dividends').delete().eq('id', id)
    fetchDividends()
  }

  const total = dividends.reduce((sum, d) => sum + Number(d.amount), 0)

  if (loading) return <div className="text-gray-500">Завантаження...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Дивіденди та доходи</h2>
        <button
          onClick={() => setShowForm(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          + Додати дохід
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="text-sm text-gray-500 mb-1">Загальна сума дивідендів</div>
        <div className="text-2xl font-bold text-green-600">{formatMoney(total)}</div>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <h3 className="font-semibold text-gray-700 mb-3">Новий дохід</h3>
          <div className="flex gap-3 items-end flex-wrap">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Тікер</label>
              <input
                type="text"
                required
                value={form.ticker}
                onChange={e => setForm({ ...form, ticker: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="AAPL"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Сума (USD)</label>
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
            <div>
              <label className="block text-sm text-gray-600 mb-1">Дата</label>
              <input
                type="date"
                value={form.date}
                onChange={e => setForm({ ...form, date: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm text-gray-600 mb-1">Нотатки</label>
              <input
                type="text"
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Необов'язково"
              />
            </div>
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
              Додати
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="text-gray-500 px-3 py-2 text-sm">
              Скасувати
            </button>
          </div>
        </form>
      )}

      {dividends.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg mb-2">Немає записів</p>
          <p className="text-sm">Додайте перший дохід від дивідендів</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left py-3 px-4 font-medium text-gray-600">Дата</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">Тікер</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">Сума</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">Нотатки</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">Дії</th>
              </tr>
            </thead>
            <tbody>
              {dividends.map(d => (
                <tr key={d.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-3 px-4 text-gray-700">{formatDate(d.date)}</td>
                  <td className="py-3 px-4 font-medium text-gray-800">{d.ticker}</td>
                  <td className="text-right py-3 px-4 font-medium text-green-600">{formatMoney(d.amount)}</td>
                  <td className="py-3 px-4 text-gray-500">{d.notes || '—'}</td>
                  <td className="text-right py-3 px-4">
                    <button onClick={() => handleDelete(d.id)} className="text-red-500 hover:text-red-700 text-xs">
                      Вид.
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
