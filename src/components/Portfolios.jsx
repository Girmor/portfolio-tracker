import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Portfolios() {
  const [portfolios, setPortfolios] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ name: '', description: '' })

  useEffect(() => { fetchPortfolios() }, [])

  async function fetchPortfolios() {
    setLoading(true)
    const { data } = await supabase
      .from('portfolios')
      .select('*, positions(id, ticker, type)')
      .order('created_at', { ascending: true })
    setPortfolios(data || [])
    setLoading(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (editingId) {
      await supabase.from('portfolios').update(form).eq('id', editingId)
    } else {
      await supabase.from('portfolios').insert(form)
    }
    setForm({ name: '', description: '' })
    setShowForm(false)
    setEditingId(null)
    fetchPortfolios()
  }

  async function handleDelete(id) {
    if (!confirm('Видалити цей портфель?')) return
    await supabase.from('portfolios').delete().eq('id', id)
    fetchPortfolios()
  }

  function startEdit(p) {
    setEditingId(p.id)
    setForm({ name: p.name, description: p.description || '' })
    setShowForm(true)
  }

  if (loading) return <div className="text-gray-500">Завантаження...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Портфелі</h2>
        <button
          onClick={() => { setShowForm(true); setEditingId(null); setForm({ name: '', description: '' }) }}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          + Новий портфель
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <h3 className="font-semibold text-gray-700 mb-3">
            {editingId ? 'Редагувати портфель' : 'Новий портфель'}
          </h3>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-sm text-gray-600 mb-1">Назва</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Довгострокові акції"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm text-gray-600 mb-1">Опис</label>
              <input
                type="text"
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Акції на 5+ років"
              />
            </div>
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
              {editingId ? 'Зберегти' : 'Створити'}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setEditingId(null) }}
              className="text-gray-500 px-3 py-2 text-sm hover:text-gray-700"
            >
              Скасувати
            </button>
          </div>
        </form>
      )}

      {portfolios.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg mb-2">Немає портфелів</p>
          <p className="text-sm">Створіть перший портфель, щоб почати відстежувати інвестиції</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {portfolios.map(p => (
            <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <Link to={`/portfolios/${p.id}`} className="text-lg font-semibold text-gray-800 hover:text-blue-600">
                  {p.name}
                </Link>
                <div className="flex gap-1">
                  <button
                    onClick={() => startEdit(p)}
                    className="text-gray-400 hover:text-blue-600 text-sm px-2 py-1"
                  >
                    Ред.
                  </button>
                  <button
                    onClick={() => handleDelete(p.id)}
                    className="text-gray-400 hover:text-red-600 text-sm px-2 py-1"
                  >
                    Вид.
                  </button>
                </div>
              </div>
              {p.description && (
                <p className="text-sm text-gray-500 mb-3">{p.description}</p>
              )}
              <div className="text-sm text-gray-600">
                Позицій: {p.positions?.length || 0}
              </div>
              <Link
                to={`/portfolios/${p.id}`}
                className="inline-block mt-3 text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                Переглянути →
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
