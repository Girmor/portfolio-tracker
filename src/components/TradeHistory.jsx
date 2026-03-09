import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { formatMoney, formatDate } from '../lib/formatters'

const TABS = [
  { key: 'trades', label: 'Купівля/продаж' },
  { key: 'adjustments', label: 'Коригування' },
]

export default function TradeHistory() {
  const [tab, setTab] = useState('trades')
  const [trades, setTrades] = useState([])
  const [adjustments, setAdjustments] = useState([])
  const [portfolios, setPortfolios] = useState([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [filterPortfolio, setFilterPortfolio] = useState('')
  const [filterTicker, setFilterTicker] = useState('')

  // Edit modals
  const [editTrade, setEditTrade] = useState(null)
  const [editAdj, setEditAdj] = useState(null)
  const [tradeForm, setTradeForm] = useState({ type: 'buy', price: '', quantity: '', date: '', notes: '' })
  const [adjForm, setAdjForm] = useState({ new_balance: '', date: '', notes: '' })

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [{ data: pData }, { data: tData }, { data: aData }] = await Promise.all([
      supabase.from('portfolios').select('id, name').order('name'),
      supabase
        .from('trades')
        .select('*, position:positions!inner(id, ticker, name, type, portfolio_id, portfolio:portfolios!inner(id, name))')
        .order('date', { ascending: false }),
      supabase
        .from('adjustments')
        .select('*, portfolio:portfolios!inner(id, name)')
        .order('date', { ascending: false }),
    ])
    setPortfolios(pData || [])
    setTrades(tData || [])
    setAdjustments(aData || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Unique tickers from trades
  const allTickers = [...new Set(trades.map(t => t.position?.ticker).filter(Boolean))].sort()

  // Filtered trades
  const filteredTrades = trades.filter(t => {
    if (filterPortfolio && t.position?.portfolio?.id !== filterPortfolio) return false
    if (filterTicker && t.position?.ticker !== filterTicker) return false
    return true
  })

  // Filtered adjustments
  const filteredAdjustments = adjustments.filter(a => {
    if (filterPortfolio && a.portfolio?.id !== filterPortfolio) return false
    return true
  })

  // Trade CRUD
  function openEditTrade(trade) {
    setEditTrade(trade)
    setTradeForm({
      type: trade.type,
      price: String(trade.price),
      quantity: String(trade.quantity),
      date: trade.date,
      notes: trade.notes || '',
    })
  }

  async function handleUpdateTrade(e) {
    e.preventDefault()
    await supabase
      .from('trades')
      .update({
        type: tradeForm.type,
        price: Number(tradeForm.price),
        quantity: Number(tradeForm.quantity),
        date: tradeForm.date,
        notes: tradeForm.notes || null,
      })
      .eq('id', editTrade.id)
    setEditTrade(null)
    fetchData()
  }

  async function handleDeleteTrade(id) {
    if (!confirm('Видалити цю угоду?')) return
    await supabase.from('trades').delete().eq('id', id)
    fetchData()
  }

  // Adjustment CRUD
  function openEditAdj(adj) {
    setEditAdj(adj)
    setAdjForm({
      new_balance: String(adj.new_balance),
      date: adj.date,
      notes: adj.notes || '',
    })
  }

  async function handleUpdateAdj(e) {
    e.preventDefault()
    const newBal = Number(adjForm.new_balance)
    if (isNaN(newBal) || newBal < 0) return
    await supabase
      .from('adjustments')
      .update({
        new_balance: newBal,
        date: adjForm.date,
        notes: adjForm.notes || null,
      })
      .eq('id', editAdj.id)
    setEditAdj(null)
    fetchData()
  }

  async function handleDeleteAdj(adj) {
    if (!confirm('Видалити це коригування?')) return
    await supabase.from('adjustments').delete().eq('id', adj.id)
    fetchData()
  }

  if (loading) return <div className="text-gray-500">Завантаження...</div>

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-6">Угоди</h2>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setFilterPortfolio(''); setFilterTicker('') }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
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
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
        filteredTrades.length === 0 ? (
          <p className="text-gray-500 text-center py-8">Немає угод</p>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left py-3 px-3 font-medium text-gray-600">Дата</th>
                  <th className="text-left py-3 px-3 font-medium text-gray-600">Портфель</th>
                  <th className="text-left py-3 px-3 font-medium text-gray-600">Тікер</th>
                  <th className="text-left py-3 px-3 font-medium text-gray-600">Тип</th>
                  <th className="text-right py-3 px-3 font-medium text-gray-600">Ціна</th>
                  <th className="text-right py-3 px-3 font-medium text-gray-600">Кількість</th>
                  <th className="text-right py-3 px-3 font-medium text-gray-600">Сума</th>
                  <th className="text-left py-3 px-3 font-medium text-gray-600">Нотатки</th>
                  <th className="text-right py-3 px-3 font-medium text-gray-600">Дії</th>
                </tr>
              </thead>
              <tbody>
                {filteredTrades.map(t => (
                  <tr key={t.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-3 text-gray-700">{formatDate(t.date)}</td>
                    <td className="py-3 px-3 text-gray-700">{t.position?.portfolio?.name || '—'}</td>
                    <td className="py-3 px-3">
                      <span className="font-medium text-gray-800">{t.position?.ticker}</span>
                    </td>
                    <td className="py-3 px-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        t.type === 'buy'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}>
                        {t.type === 'buy' ? 'Купівля' : 'Продаж'}
                      </span>
                    </td>
                    <td className="text-right py-3 px-3 text-gray-700">{formatMoney(t.price)}</td>
                    <td className="text-right py-3 px-3 text-gray-700">{t.quantity}</td>
                    <td className="text-right py-3 px-3 font-medium text-gray-800">
                      {formatMoney(Number(t.price) * Number(t.quantity))}
                    </td>
                    <td className="py-3 px-3 text-gray-500 text-xs max-w-[150px] truncate">{t.notes || '—'}</td>
                    <td className="text-right py-3 px-3 whitespace-nowrap">
                      <button
                        onClick={() => openEditTrade(t)}
                        className="text-blue-600 hover:text-blue-800 text-xs mr-2"
                      >
                        Ред.
                      </button>
                      <button
                        onClick={() => handleDeleteTrade(t.id)}
                        className="text-red-500 hover:text-red-700 text-xs"
                      >
                        Вид.
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Adjustments Tab */}
      {tab === 'adjustments' && (
        filteredAdjustments.length === 0 ? (
          <p className="text-gray-500 text-center py-8">Немає коригувань</p>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left py-3 px-3 font-medium text-gray-600">Дата</th>
                  <th className="text-left py-3 px-3 font-medium text-gray-600">Портфель</th>
                  <th className="text-right py-3 px-3 font-medium text-gray-600">Попередній</th>
                  <th className="text-right py-3 px-3 font-medium text-gray-600">Новий</th>
                  <th className="text-right py-3 px-3 font-medium text-gray-600">Різниця</th>
                  <th className="text-left py-3 px-3 font-medium text-gray-600">Нотатки</th>
                  <th className="text-right py-3 px-3 font-medium text-gray-600">Дії</th>
                </tr>
              </thead>
              <tbody>
                {filteredAdjustments.map(a => {
                  const diff = Number(a.new_balance) - Number(a.previous_balance)
                  return (
                    <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3 px-3 text-gray-700">{formatDate(a.date)}</td>
                      <td className="py-3 px-3 text-gray-700">{a.portfolio?.name || '—'}</td>
                      <td className="text-right py-3 px-3 text-gray-700">{formatMoney(a.previous_balance)}</td>
                      <td className="text-right py-3 px-3 font-medium text-gray-800">{formatMoney(a.new_balance)}</td>
                      <td className={`text-right py-3 px-3 font-medium ${diff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {diff >= 0 ? '+' : ''}{formatMoney(diff)}
                      </td>
                      <td className="py-3 px-3 text-gray-500 text-xs max-w-[150px] truncate">{a.notes || '—'}</td>
                      <td className="text-right py-3 px-3 whitespace-nowrap">
                        <button
                          onClick={() => openEditAdj(a)}
                          className="text-blue-600 hover:text-blue-800 text-xs mr-2"
                        >
                          Ред.
                        </button>
                        <button
                          onClick={() => handleDeleteAdj(a)}
                          className="text-red-500 hover:text-red-700 text-xs"
                        >
                          Вид.
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Edit Trade Modal */}
      {editTrade && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <form onSubmit={handleUpdateTrade} className="bg-white rounded-xl p-6 w-full max-w-md shadow-lg">
            <h3 className="font-semibold text-gray-800 mb-4">
              Редагувати угоду — {editTrade.position?.ticker}
            </h3>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Тип</label>
                <select
                  value={tradeForm.type}
                  onChange={e => setTradeForm({ ...tradeForm, type: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="buy">Купівля</option>
                  <option value="sell">Продаж</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Дата</label>
                <input
                  type="date"
                  value={tradeForm.date}
                  onChange={e => setTradeForm({ ...tradeForm, date: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Ціна</label>
                <input
                  type="number"
                  step="any"
                  required
                  value={tradeForm.price}
                  onChange={e => setTradeForm({ ...tradeForm, price: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Кількість</label>
                <input
                  type="number"
                  step="any"
                  required
                  value={tradeForm.quantity}
                  onChange={e => setTradeForm({ ...tradeForm, quantity: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-sm text-gray-600 mb-1">Нотатки</label>
              <input
                type="text"
                value={tradeForm.notes}
                onChange={e => setTradeForm({ ...tradeForm, notes: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Необов'язково"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setEditTrade(null)} className="text-gray-500 px-4 py-2 text-sm">
                Скасувати
              </button>
              <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
                Зберегти
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Adjustment Modal */}
      {editAdj && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <form onSubmit={handleUpdateAdj} className="bg-white rounded-xl p-6 w-full max-w-md shadow-lg">
            <h3 className="font-semibold text-gray-800 mb-4">
              Редагувати коригування — {editAdj.portfolio?.name}
            </h3>
            <div className="mb-3">
              <label className="block text-sm text-gray-600 mb-1">Дата</label>
              <input
                type="date"
                value={adjForm.date}
                onChange={e => setAdjForm({ ...adjForm, date: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="mb-3">
              <label className="block text-sm text-gray-600 mb-1">Попередній баланс</label>
              <div className="text-lg font-semibold text-gray-800 bg-gray-50 rounded-lg px-3 py-2">
                {formatMoney(editAdj.previous_balance)}
              </div>
            </div>
            <div className="mb-3">
              <label className="block text-sm text-gray-600 mb-1">Новий баланс</label>
              <input
                type="number"
                step="any"
                required
                min="0"
                value={adjForm.new_balance}
                onChange={e => setAdjForm({ ...adjForm, new_balance: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm text-gray-600 mb-1">Нотатки</label>
              <input
                type="text"
                value={adjForm.notes}
                onChange={e => setAdjForm({ ...adjForm, notes: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Необов'язково"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setEditAdj(null)} className="text-gray-500 px-4 py-2 text-sm">
                Скасувати
              </button>
              <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
                Зберегти
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
