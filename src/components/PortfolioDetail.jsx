import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getCryptoPrices, getStockPrices, getCoinId, searchStocks, searchCrypto, resolveMissingCoinIds } from '../lib/priceService'
import { formatMoney, formatNumber, formatPercent, formatDate, pnlColor } from '../lib/formatters'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import PortfolioHistoryChart from './PortfolioHistoryChart'

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16']

export default function PortfolioDetail() {
  const { id } = useParams()
  const [portfolio, setPortfolio] = useState(null)
  const [positions, setPositions] = useState([])
  const [prices, setPrices] = useState({})
  const [loading, setLoading] = useState(true)
  const [showAddPosition, setShowAddPosition] = useState(false)
  const [showAddTrade, setShowAddTrade] = useState(null)
  const [posForm, setPosForm] = useState({ ticker: '', name: '', type: 'stock', coinId: '' })
  const [tradeForm, setTradeForm] = useState({ type: 'buy', price: '', quantity: '', date: '', notes: '' })
  const [suggestions, setSuggestions] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [showCashModal, setShowCashModal] = useState(false)
  const [cashForm, setCashForm] = useState({ date: new Date().toISOString().split('T')[0], newBalance: '' })

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [{ data: pData }, { data: posData }] = await Promise.all([
      supabase.from('portfolios').select('*').eq('id', id).single(),
      supabase.from('positions').select('*, trades(*)').eq('portfolio_id', id).order('created_at', { ascending: true }),
    ])
    setPortfolio(pData)
    const resolvedPositions = await resolveMissingCoinIds(posData || [], supabase)
    setPositions(resolvedPositions)
    await fetchPrices(resolvedPositions)
    setLoading(false)
  }, [id])

  async function fetchPrices(positions) {
    const cryptoTickers = positions.filter(p => p.type === 'crypto').map(p => getCoinId(p))
    const stockTickers = positions.filter(p => p.type === 'stock').map(p => p.ticker)

    const [cryptoPrices, stockPrices] = await Promise.all([
      cryptoTickers.length ? getCryptoPrices(cryptoTickers) : {},
      stockTickers.length ? getStockPrices(stockTickers) : {},
    ])

    setPrices(prev => {
      const merged = { ...prev }
      positions.forEach(p => {
        if (p.type === 'crypto') {
          const newPrice = cryptoPrices[getCoinId(p)]
          if (newPrice != null) merged[p.ticker] = newPrice
        } else {
          const newPrice = stockPrices[p.ticker]
          if (newPrice != null) merged[p.ticker] = newPrice
        }
      })
      return merged
    })
  }

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    if (positions.length === 0) return
    const interval = setInterval(() => fetchPrices(positions), 60000)
    return () => clearInterval(interval)
  }, [positions])

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
    }
  }

  useEffect(() => {
    const query = posForm.ticker.trim()
    if (query.length < 1) { setSuggestions([]); return }
    const timeout = setTimeout(async () => {
      setSearchLoading(true)
      const results = posForm.type === 'crypto'
        ? await searchCrypto(query)
        : await searchStocks(query)
      setSuggestions(results)
      setSearchLoading(false)
      setShowSuggestions(true)
    }, 300)
    return () => clearTimeout(timeout)
  }, [posForm.ticker, posForm.type])

  function selectSuggestion(item) {
    setPosForm({
      ...posForm,
      ticker: item.ticker,
      name: item.name,
      coinId: item.coinId || '',
    })
    setSuggestions([])
    setShowSuggestions(false)
  }

  async function handleAddPosition(e) {
    e.preventDefault()
    await supabase.from('positions').insert({
      ticker: posForm.ticker.toUpperCase(),
      name: posForm.name,
      type: posForm.type,
      coin_id: posForm.coinId || null,
      portfolio_id: id,
    })
    setPosForm({ ticker: '', name: '', type: 'stock', coinId: '' })
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

  async function handleCashAdjustment(e) {
    e.preventDefault()
    const newBalance = Number(cashForm.newBalance)
    if (isNaN(newBalance) || newBalance < 0) return
    await supabase.from('adjustments').insert({
      portfolio_id: id,
      previous_balance: cashBalance,
      new_balance: newBalance,
      date: cashForm.date || new Date().toISOString().split('T')[0],
    })
    await supabase
      .from('portfolios')
      .update({ cash_balance: newBalance })
      .eq('id', id)
    setShowCashModal(false)
    setCashForm({ date: new Date().toISOString().split('T')[0], newBalance: '' })
    fetchData()
  }

  if (loading) return <div className="text-gray-500">Завантаження...</div>
  if (!portfolio) return <div className="text-red-500">Портфель не знайдено</div>

  const cashBalance = Number(portfolio?.cash_balance) || 0
  const posCalcs = positions.map(p => ({ pos: p, calc: calcPosition(p) }))
  const activePositions = posCalcs.filter(({ calc }) => calc.totalQty > 0)
  const soldPositions = posCalcs.filter(({ calc }) => calc.totalQty <= 0 && (calc.realizedPnl !== 0 || (calc.pos?.trades?.length ?? 0) > 0))
  const totalInvestmentValue = activePositions.reduce((sum, { calc }) => sum + calc.marketValue, 0)
  const totalValue = totalInvestmentValue + cashBalance
  const totalCost = activePositions.reduce((sum, { calc }) => sum + calc.totalCost, 0)
  const totalUnrealizedPnl = activePositions.reduce((sum, { calc }) => sum + calc.unrealizedPnl, 0)
  const totalRealizedPnl = posCalcs.reduce((sum, { calc }) => sum + calc.realizedPnl, 0)
  const unrealizedPnlPercent = totalCost > 0 ? (totalUnrealizedPnl / totalCost) * 100 : 0
  const soldTotalRealizedPnl = soldPositions.reduce((sum, { calc }) => sum + calc.realizedPnl, 0)

  const allocationData = activePositions
    .map(({ pos, calc }) => ({ name: pos.ticker, value: Math.max(0, calc.marketValue) }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value)

  const bestPerformer = activePositions.reduce((best, item) =>
    !best || item.calc.unrealizedPnlPercent > best.calc.unrealizedPnlPercent ? item : best
  , null)
  const worstPerformer = activePositions.reduce((worst, item) =>
    !worst || item.calc.unrealizedPnlPercent < worst.calc.unrealizedPnlPercent ? item : worst
  , null)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link to="/portfolios" className="text-gray-400 hover:text-gray-600">← Назад</Link>
        <h2 className="text-2xl font-bold text-gray-800">{portfolio.name}</h2>
      </div>

      {/* Summary Stats + Allocation Row */}
      <div className="flex flex-col lg:flex-row gap-3 mb-6">
        {/* Stats Cards — 2/3 */}
        <div className="lg:w-2/3 grid grid-cols-2 gap-3">
          {/* Card 1: Portfolio Value */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-xs text-gray-500 mb-1">Вартість портфеля</div>
            <div className="text-xl font-bold text-gray-800">{formatMoney(totalValue)}</div>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-xs text-gray-400">Готівка: {formatMoney(cashBalance)}</span>
              <button
                onClick={() => {
                  setCashForm({ date: new Date().toISOString().split('T')[0], newBalance: String(cashBalance) })
                  setShowCashModal(true)
                }}
                className="text-[10px] text-blue-600 hover:text-blue-800 font-medium border border-blue-200 rounded px-1.5 py-0.5"
              >
                Коригування
              </button>
            </div>
          </div>

          {/* Card 2: Invested + P&L */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-xs text-gray-500 mb-1">Інвестовано</div>
            <div className="text-xl font-bold text-gray-800">{formatMoney(totalCost)}</div>
            <div className={`text-xs mt-1.5 ${pnlColor(totalUnrealizedPnl)}`}>
              P&L: {formatMoney(totalUnrealizedPnl)} ({formatPercent(unrealizedPnlPercent)})
            </div>
          </div>

          {/* Card 3: Best Performer */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-xs text-gray-500 mb-1">Найкращий актив</div>
            {bestPerformer ? (
              <>
                <div className="text-xl font-bold text-gray-800">{bestPerformer.pos.ticker}</div>
                <div className="text-xs text-green-600 mt-1.5">
                  {formatMoney(bestPerformer.calc.unrealizedPnl)} &nbsp;{formatPercent(bestPerformer.calc.unrealizedPnlPercent)}
                </div>
              </>
            ) : (
              <div className="text-sm text-gray-400 mt-1">—</div>
            )}
          </div>

          {/* Card 4: Worst Performer */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-xs text-gray-500 mb-1">Найгірший актив</div>
            {worstPerformer ? (
              <>
                <div className="text-xl font-bold text-gray-800">{worstPerformer.pos.ticker}</div>
                <div className="text-xs text-red-600 mt-1.5">
                  {formatMoney(worstPerformer.calc.unrealizedPnl)} &nbsp;{formatPercent(worstPerformer.calc.unrealizedPnlPercent)}
                </div>
              </>
            ) : (
              <div className="text-sm text-gray-400 mt-1">—</div>
            )}
          </div>
        </div>

        {/* Allocation — 1/3 */}
        {allocationData.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 lg:w-1/3 shrink-0">
            <div className="text-xs text-gray-500 mb-2">Алокація</div>
            <div className="flex items-center justify-center gap-5">
              <div className="w-32 h-32 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={allocationData}
                      cx="50%"
                      cy="50%"
                      innerRadius={38}
                      outerRadius={58}
                      dataKey="value"
                    >
                      {allocationData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => formatMoney(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: '140px' }}>
                {allocationData.map((item, i) => {
                  const percent = totalInvestmentValue > 0
                    ? ((item.value / totalInvestmentValue) * 100).toFixed(1)
                    : '0.0'
                  return (
                    <div key={item.name} className="flex items-center gap-2">
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: COLORS[i % COLORS.length] }}
                      />
                      <span className="text-sm text-gray-700 whitespace-nowrap">{item.name}</span>
                      <span className="text-sm text-gray-400 tabular-nums">{percent}%</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Portfolio History Chart */}
      <PortfolioHistoryChart portfolioId={id} />

      {/* Holdings Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-700">Холдинги</h3>
        <button
          onClick={() => setShowAddPosition(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          + Додати позицію
        </button>
      </div>

      {/* Add Position Form */}
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
            <div className="relative flex-1">
              <label className="block text-sm text-gray-600 mb-1">Пошук активу</label>
              <input
                type="text"
                required
                autoComplete="off"
                value={posForm.ticker}
                onChange={e => { setPosForm({ ...posForm, ticker: e.target.value, name: '' }); setShowSuggestions(true) }}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={posForm.type === 'crypto' ? 'Введіть назву або тікер (BTC, Ethereum...)' : 'Введіть тікер або назву (AAPL, Tesla...)'}
              />
              {searchLoading && (
                <div className="absolute right-3 top-8 text-xs text-gray-400">Пошук...</div>
              )}
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {suggestions.map((item, i) => (
                    <button
                      key={`${item.ticker}-${i}`}
                      type="button"
                      onMouseDown={() => selectSuggestion(item)}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center justify-between text-sm border-b border-gray-50 last:border-0"
                    >
                      <div>
                        <span className="font-medium text-gray-800">{item.ticker}</span>
                        <span className="text-gray-500 ml-2">{item.name}</span>
                      </div>
                      {item.type && <span className="text-xs text-gray-400">{item.type}</span>}
                    </button>
                  ))}
                </div>
              )}
              {posForm.name && (
                <div className="text-xs text-green-600 mt-1">Обрано: {posForm.ticker} — {posForm.name}</div>
              )}
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

      {/* Holdings Table */}
      {activePositions.length === 0 && soldPositions.length === 0 ? (
        <p className="text-gray-500 text-center py-8">Додайте першу позицію</p>
      ) : activePositions.length === 0 ? (
        <p className="text-gray-500 text-center py-8">Немає активних позицій</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left py-3 px-3 font-medium text-gray-600">Назва</th>
                <th className="text-right py-3 px-3 font-medium text-gray-600">Кількість</th>
                <th className="text-right py-3 px-3 font-medium text-gray-600">Сер. ціна</th>
                <th className="text-right py-3 px-3 font-medium text-gray-600">Ціна</th>
                <th className="text-right py-3 px-3 font-medium text-gray-600">Інвестовано</th>
                <th className="text-right py-3 px-3 font-medium text-gray-600">Ринкова вар.</th>
                <th className="text-right py-3 px-3 font-medium text-gray-600">Нереаліз. P&L</th>
                <th className="text-right py-3 px-3 font-medium text-gray-600">Нереаліз. %</th>
                <th className="text-right py-3 px-3 font-medium text-gray-600">Реаліз. P&L</th>
                <th className="text-right py-3 px-3 font-medium text-gray-600">Реаліз. %</th>
                <th className="text-right py-3 px-3 font-medium text-gray-600">Алокація</th>
                <th className="text-right py-3 px-3 font-medium text-gray-600">Дії</th>
              </tr>
            </thead>
            <tbody>
              {activePositions.map(({ pos, calc }) => {
                const allocation = totalInvestmentValue > 0
                  ? (calc.marketValue / totalInvestmentValue) * 100
                  : 0
                return (
                  <tr key={pos.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-3">
                      <div className="font-medium text-gray-800">{pos.ticker}</div>
                      <div className="text-xs text-gray-500 truncate max-w-[140px]">{pos.name || (pos.type === 'stock' ? 'Акція' : 'Крипто')}</div>
                    </td>
                    <td className="text-right py-3 px-3 text-gray-700">{formatNumber(calc.totalQty, 4)}</td>
                    <td className="text-right py-3 px-3 text-gray-700">{formatMoney(calc.avgPrice)}</td>
                    <td className="text-right py-3 px-3 text-gray-700">
                      {calc.currentPrice ? formatMoney(calc.currentPrice) : '---'}
                    </td>
                    <td className="text-right py-3 px-3 text-gray-700">{formatMoney(calc.totalCost)}</td>
                    <td className="text-right py-3 px-3 font-medium text-gray-800">{formatMoney(calc.marketValue)}</td>
                    <td className={`text-right py-3 px-3 font-medium ${pnlColor(calc.unrealizedPnl)}`}>
                      {formatMoney(calc.unrealizedPnl)}
                    </td>
                    <td className={`text-right py-3 px-3 font-medium ${pnlColor(calc.unrealizedPnlPercent)}`}>
                      {formatPercent(calc.unrealizedPnlPercent)}
                    </td>
                    <td className={`text-right py-3 px-3 font-medium ${pnlColor(calc.realizedPnl)}`}>
                      {calc.realizedPnl !== 0 ? formatMoney(calc.realizedPnl) : '—'}
                    </td>
                    <td className={`text-right py-3 px-3 font-medium ${pnlColor(calc.realizedPnlPercent)}`}>
                      {calc.realizedPnl !== 0 ? formatPercent(calc.realizedPnlPercent) : '—'}
                    </td>
                    <td className="text-right py-3 px-3 text-gray-700">
                      {allocation.toFixed(2)}%
                    </td>
                    <td className="text-right py-3 px-3 whitespace-nowrap">
                      <button
                        onClick={() => { setShowAddTrade(pos.id); setTradeForm({ type: 'buy', price: prices[pos.ticker] ? String(prices[pos.ticker]) : '', quantity: '', date: new Date().toISOString().split('T')[0], notes: '' }) }}
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
            <tfoot>
              <tr className="border-t-2 border-gray-300 bg-gray-50 font-medium">
                <td className="py-3 px-3 text-gray-800">Всього</td>
                <td className="text-right py-3 px-3"></td>
                <td className="text-right py-3 px-3"></td>
                <td className="text-right py-3 px-3"></td>
                <td className="text-right py-3 px-3 text-gray-800">{formatMoney(totalCost)}</td>
                <td className="text-right py-3 px-3 text-gray-800">{formatMoney(totalInvestmentValue)}</td>
                <td className={`text-right py-3 px-3 ${pnlColor(totalUnrealizedPnl)}`}>{formatMoney(totalUnrealizedPnl)}</td>
                <td className={`text-right py-3 px-3 ${pnlColor(unrealizedPnlPercent)}`}>{formatPercent(unrealizedPnlPercent)}</td>
                <td className={`text-right py-3 px-3 ${pnlColor(totalRealizedPnl)}`}>{totalRealizedPnl !== 0 ? formatMoney(totalRealizedPnl) : '—'}</td>
                <td className="text-right py-3 px-3"></td>
                <td className="text-right py-3 px-3 text-gray-800">100%</td>
                <td className="text-right py-3 px-3"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Sold Positions Table */}
      {soldPositions.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-semibold text-gray-700 mb-4">Продані активи</h3>
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left py-3 px-3 font-medium text-gray-600">Назва</th>
                  <th className="text-right py-3 px-3 font-medium text-gray-600">Куплено (шт.)</th>
                  <th className="text-right py-3 px-3 font-medium text-gray-600">Сер. ціна купівлі</th>
                  <th className="text-right py-3 px-3 font-medium text-gray-600">Інвестовано</th>
                  <th className="text-right py-3 px-3 font-medium text-gray-600">Виручка</th>
                  <th className="text-right py-3 px-3 font-medium text-gray-600">Реаліз. P&L</th>
                  <th className="text-right py-3 px-3 font-medium text-gray-600">Реаліз. %</th>
                  <th className="text-right py-3 px-3 font-medium text-gray-600">Дії</th>
                </tr>
              </thead>
              <tbody>
                {soldPositions.map(({ pos, calc }) => {
                  const trades = pos.trades || []
                  let totalBuyQty = 0, totalBuyCost = 0, totalSellProceeds = 0
                  trades.forEach(t => {
                    const qty = Number(t.quantity)
                    const price = Number(t.price)
                    if (t.type === 'buy') { totalBuyQty += qty; totalBuyCost += price * qty }
                    else { totalSellProceeds += price * qty }
                  })
                  return (
                    <tr key={pos.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3 px-3">
                        <div className="font-medium text-gray-500">{pos.ticker}</div>
                        <div className="text-xs text-gray-400 truncate max-w-[140px]">{pos.name || (pos.type === 'stock' ? 'Акція' : 'Крипто')}</div>
                      </td>
                      <td className="text-right py-3 px-3 text-gray-500">{formatNumber(totalBuyQty, 4)}</td>
                      <td className="text-right py-3 px-3 text-gray-500">{formatMoney(calc.avgPrice)}</td>
                      <td className="text-right py-3 px-3 text-gray-500">{formatMoney(totalBuyCost)}</td>
                      <td className="text-right py-3 px-3 text-gray-500">{formatMoney(totalSellProceeds)}</td>
                      <td className={`text-right py-3 px-3 font-medium ${pnlColor(calc.realizedPnl)}`}>
                        {formatMoney(calc.realizedPnl)}
                      </td>
                      <td className={`text-right py-3 px-3 font-medium ${pnlColor(calc.realizedPnlPercent)}`}>
                        {formatPercent(calc.realizedPnlPercent)}
                      </td>
                      <td className="text-right py-3 px-3 whitespace-nowrap">
                        <button
                          onClick={() => { setShowAddTrade(pos.id); setTradeForm({ type: 'buy', price: '', quantity: '', date: new Date().toISOString().split('T')[0], notes: '' }) }}
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
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-gray-50 font-medium">
                  <td className="py-3 px-3 text-gray-800">Всього продано</td>
                  <td className="text-right py-3 px-3"></td>
                  <td className="text-right py-3 px-3"></td>
                  <td className="text-right py-3 px-3"></td>
                  <td className="text-right py-3 px-3"></td>
                  <td className={`text-right py-3 px-3 ${pnlColor(soldTotalRealizedPnl)}`}>{formatMoney(soldTotalRealizedPnl)}</td>
                  <td className="text-right py-3 px-3"></td>
                  <td className="text-right py-3 px-3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Trade Modal */}
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

      {/* Cash Adjustment Modal */}
      {showCashModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <form onSubmit={handleCashAdjustment} className="bg-white rounded-xl p-6 w-full max-w-md shadow-lg">
            <h3 className="font-semibold text-gray-800 mb-4">Коригування готівки</h3>

            <div className="mb-3">
              <label className="block text-sm text-gray-600 mb-1">Дата</label>
              <input
                type="date"
                value={cashForm.date}
                onChange={e => setCashForm({ ...cashForm, date: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="mb-3">
              <label className="block text-sm text-gray-600 mb-1">Поточний баланс</label>
              <div className="text-lg font-semibold text-gray-800 bg-gray-50 rounded-lg px-3 py-2">
                {formatMoney(Number(portfolio?.cash_balance) || 0)}
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm text-gray-600 mb-1">Новий баланс</label>
              <input
                type="number"
                step="any"
                required
                min="0"
                value={cashForm.newBalance}
                onChange={e => setCashForm({ ...cashForm, newBalance: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
              />
            </div>

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowCashModal(false)}
                className="text-gray-500 px-4 py-2 text-sm"
              >
                Скасувати
              </button>
              <button
                type="submit"
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
              >
                Зберегти
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
