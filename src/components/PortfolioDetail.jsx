import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getCryptoPrices, getStockPrices, tickerToCoinId } from '../lib/priceService'
import { formatMoney, formatNumber, formatPercent, formatDate, pnlColor } from '../lib/formatters'

export default function PortfolioDetail() {
  const { id } = useParams()
  const [portfolio, setPortfolio] = useState(null)
  const [positions, setPositions] = useState([])
  const [prices, setPrices] = useState({})
  const [loading, setLoading] = useState(true)
  const [showAddPosition, setShowAddPosition] = useState(false)
  const [showAddTrade, setShowAddTrade] = useState(null)
  const [posForm, setPosForm] = useState({ ticker: '', name: '', type: 'stock' })
  const [tradeForm, setTradeForm] = useState({ type: 'buy', price: '', quantity: '', date: '', notes: '' })

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [{ data: pData }, { data: posData }] = await Promise.all([
      supabase.from('portfolios').select('*').eq('id', id).single(),
      supabase.from('positions').select('*, trades(*)').eq('portfolio_id', id).order('created_at', { ascending: true }),
    ])
    setPortfolio(pData)
    setPositions(posData || [])
    await fetchPrices(posData || [])
    setLoading(false)
  }, [id])

  async function fetchPrices(positions) {
    const cryptoTickers = positions.filter(p => p.type === 'crypto').map(p => tickerToCoinId(p.ticker))
    const stockTickers = positions.filter(p => p.type === 'stock').map(p => p.ticker)

    const [cryptoPrices, stockPrices] = await Promise.all([
      cryptoTickers.length ? getCryptoPrices(cryptoTickers) : {},
      stockTickers.length ? getStockPrices(stockTickers) : {},
    ])

    const merged = {}
    positions.forEach(p => {
      if (p.type === 'crypto') {
        merged[p.ticker] = cryptoPrices[tickerToCoinId(p.ticker)] ?? null
      } else {
        merged[p.ticker] = stockPrices[p.ticker] ?? null
      }
    })
    setPrices(merged)
  }

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    if (positions.length === 0) return
    const interval = setInterval(() => fetchPrices(positions), 60000)
    return () => clearInterval(interval)
  }, [positions])

  function calcPosition(pos) {
    const trades = pos.trades || []
    let totalQty = 0
    let totalCost = 0
    trades.forEach(t => {
      if (t.type === 'buy') {
        totalQty += Number(t.quantity)
        totalCost += Number(t.price) * Number(t.quantity)
      } else {
        totalQty -= Number(t.quantity)
        totalCost -= Number(t.price) * Number(t.quantity)
      }
    })
    const avgPrice = totalQty > 0 ? totalCost / totalQty : 0
    const currentPrice = prices[pos.ticker] ?? 0
    const marketValue = totalQty * currentPrice
    const pnl = marketValue - totalCost
    const pnlPercent = totalCost > 0 ? (pnl / totalCost) * 100 : 0
    return { totalQty, avgPrice, totalCost, currentPrice, marketValue, pnl, pnlPercent }
  }

  async function handleAddPosition(e) {
    e.preventDefault()
    await supabase.from('positions').insert({
      ...posForm,
      ticker: posForm.ticker.toUpperCase(),
      portfolio_id: id,
    })
    setPosForm({ ticker: '', name: '', type: 'stock' })
    setShowAddPosition(false)
    fetchData()
  }

  async function handleAddTrade(e) {
    e.preventDefault()
    await supabase.from('trades').insert({
      position_id: showAddTrade,
      type: tradeForm.type,
      price: Number(tradeForm.price),
      quantity: Number(tradeForm.quantity),
      date: tradeForm.date || new Date().toISOString().split('T')[0],
      notes: tradeForm.notes || null,
    })
    setTradeForm({ type: 'buy', price: '', quantity: '', date: '', notes: '' })
    setShowAddTrade(null)
    fetchData()
  }

  async function handleDeletePosition(posId) {
    if (!confirm('Видалити позицію та всі її угоди?')) return
    await supabase.from('trades').delete().eq('position_id', posId)
    await supabase.from('positions').delete().eq('id', posId)
    fetchData()
  }

  if (loading) return <div className="text-gray-500">Завантаження...</div>
  if (!portfolio) return <div className="text-red-500">Портфель не знайдено</div>

  const totalValue = positions.reduce((sum, p) => sum + calcPosition(p).marketValue, 0)
  const totalPnl = positions.reduce((sum, p) => sum + calcPosition(p).pnl, 0)
  const totalCost = positions.reduce((sum, p) => sum + calcPosition(p).totalCost, 0)

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link to="/portfolios" className="text-gray-400 hover:text-gray-600">← Назад</Link>
        <h2 className="text-2xl font-bold text-gray-800">{portfolio.name}</h2>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">Вартість портфеля</div>
          <div className="text-2xl font-bold text-gray-800">{formatMoney(totalValue)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">Інвестовано</div>
          <div className="text-2xl font-bold text-gray-800">{formatMoney(totalCost)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">P&L</div>
          <div className={`text-2xl font-bold ${pnlColor(totalPnl)}`}>
            {formatMoney(totalPnl)} ({formatPercent(totalCost > 0 ? (totalPnl / totalCost) * 100 : 0)})
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-700">Позиції</h3>
        <button
          onClick={() => setShowAddPosition(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          + Додати позицію
        </button>
      </div>

      {showAddPosition && (
        <form onSubmit={handleAddPosition} className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
          <div className="flex gap-3 items-end">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Тип</label>
              <select
                value={posForm.type}
                onChange={e => setPosForm({ ...posForm, type: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="stock">Акція</option>
                <option value="crypto">Крипто</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Тікер</label>
              <input
                type="text"
                required
                value={posForm.ticker}
                onChange={e => setPosForm({ ...posForm, ticker: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={posForm.type === 'crypto' ? 'BTC' : 'AAPL'}
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm text-gray-600 mb-1">Назва</label>
              <input
                type="text"
                value={posForm.name}
                onChange={e => setPosForm({ ...posForm, name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={posForm.type === 'crypto' ? 'Bitcoin' : 'Apple Inc.'}
              />
            </div>
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
              Додати
            </button>
            <button type="button" onClick={() => setShowAddPosition(false)} className="text-gray-500 px-3 py-2 text-sm">
              Скасувати
            </button>
          </div>
        </form>
      )}

      {positions.length === 0 ? (
        <p className="text-gray-500 text-center py-8">Додайте першу позицію</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left py-3 px-4 font-medium text-gray-600">Актив</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">Кількість</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">Сер. ціна</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">Поточна ціна</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">Вартість</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">P&L</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">Дії</th>
              </tr>
            </thead>
            <tbody>
              {positions.map(pos => {
                const calc = calcPosition(pos)
                return (
                  <tr key={pos.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4">
                      <div className="font-medium text-gray-800">{pos.ticker}</div>
                      <div className="text-xs text-gray-500">{pos.name || (pos.type === 'stock' ? 'Акція' : 'Крипто')}</div>
                    </td>
                    <td className="text-right py-3 px-4 text-gray-700">{formatNumber(calc.totalQty, 4)}</td>
                    <td className="text-right py-3 px-4 text-gray-700">{formatMoney(calc.avgPrice)}</td>
                    <td className="text-right py-3 px-4 text-gray-700">
                      {calc.currentPrice ? formatMoney(calc.currentPrice) : '—'}
                    </td>
                    <td className="text-right py-3 px-4 font-medium text-gray-800">{formatMoney(calc.marketValue)}</td>
                    <td className={`text-right py-3 px-4 font-medium ${pnlColor(calc.pnl)}`}>
                      {formatMoney(calc.pnl)}<br/>
                      <span className="text-xs">{formatPercent(calc.pnlPercent)}</span>
                    </td>
                    <td className="text-right py-3 px-4">
                      <button
                        onClick={() => { setShowAddTrade(pos.id); setTradeForm({ type: 'buy', price: '', quantity: '', date: '', notes: '' }) }}
                        className="text-blue-600 hover:text-blue-800 text-xs mr-2"
                      >
                        +Угода
                      </button>
                      <button
                        onClick={() => handleDeletePosition(pos.id)}
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
      )}

      {showAddTrade && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <form onSubmit={handleAddTrade} className="bg-white rounded-xl p-6 w-full max-w-md shadow-lg">
            <h3 className="font-semibold text-gray-800 mb-4">Нова угода</h3>
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
                  placeholder="0.00"
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
                  placeholder="0"
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
              <button type="button" onClick={() => setShowAddTrade(null)} className="text-gray-500 px-4 py-2 text-sm">
                Скасувати
              </button>
              <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
                Додати угоду
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
