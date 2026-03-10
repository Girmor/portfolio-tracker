import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'
import { supabase } from '../lib/supabase'
import { getCryptoPrices, getStockPrices, getCoinId, resolveMissingCoinIds } from '../lib/priceService'
import { formatMoney, formatPercent, pnlColor } from '../lib/formatters'
import PortfolioHistoryChart from './PortfolioHistoryChart'

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16']

export default function Overview() {
  const [portfolios, setPortfolios] = useState([])
  const [budget, setBudget] = useState([])
  const [prices, setPrices] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: pData }, { data: bData }] = await Promise.all([
      supabase.from('portfolios').select('*, positions(*, trades(*))').order('created_at', { ascending: true }),
      supabase.from('budget').select('*'),
    ])
    setBudget(bData || [])

    const allPositions = (pData || []).flatMap(p => p.positions || [])
    const resolvedPositions = await resolveMissingCoinIds(allPositions, supabase)

    // Rebuild portfolios with resolved positions
    const resolvedPortfolios = (pData || []).map(p => ({
      ...p,
      positions: (p.positions || []).map(pos => {
        const resolved = resolvedPositions.find(rp => rp.id === pos.id)
        return resolved || pos
      })
    }))
    setPortfolios(resolvedPortfolios)

    const cryptoIds = resolvedPositions.filter(p => p.type === 'crypto').map(p => getCoinId(p))
    const stockTickers = resolvedPositions.filter(p => p.type === 'stock').map(p => p.ticker)

    const [cryptoPrices, stockPrices] = await Promise.all([
      cryptoIds.length ? getCryptoPrices([...new Set(cryptoIds)]) : {},
      stockTickers.length ? getStockPrices([...new Set(stockTickers)]) : {},
    ])

    setPrices(prev => {
      const merged = { ...prev }
      resolvedPositions.forEach(p => {
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
    setLoading(false)
  }

  function calcPositionValue(pos) {
    const trades = pos.trades || []
    let qty = 0, cost = 0
    trades.forEach(t => {
      if (t.type === 'buy') { qty += Number(t.quantity); cost += Number(t.price) * Number(t.quantity) }
      else { qty -= Number(t.quantity); cost -= Number(t.price) * Number(t.quantity) }
    })
    const price = prices[pos.ticker] ?? 0
    return { value: qty * price, cost, pnl: qty * price - cost }
  }

  function calcPortfolioValue(p) {
    return (p.positions || []).reduce((sum, pos) => {
      const { value } = calcPositionValue(pos)
      return sum + value
    }, 0)
  }

  function calcPortfolioPnl(p) {
    return (p.positions || []).reduce((sum, pos) => sum + calcPositionValue(pos).pnl, 0)
  }

  const budgetTotal = budget.reduce((sum, b) => {
    if (b.currency === 'USD') return sum + Number(b.amount)
    if (b.currency === 'EUR') return sum + Number(b.amount) * 1.08
    if (b.currency === 'UAH') return sum + Number(b.amount) / 41.5
    return sum + Number(b.amount)
  }, 0)

  const investmentTotal = portfolios.reduce((sum, p) => sum + calcPortfolioValue(p), 0)
  const investmentCost = portfolios.reduce((sum, p) =>
    sum + (p.positions || []).reduce((s, pos) => s + calcPositionValue(pos).cost, 0)
  , 0)
  const totalCapital = budgetTotal + investmentTotal
  const totalPnl = portfolios.reduce((sum, p) => sum + calcPortfolioPnl(p), 0)
  const totalPnlPercent = investmentCost > 0 ? (totalPnl / investmentCost) * 100 : 0

  // Best/worst portfolio by P&L percent
  const portfolioPnls = portfolios.map(p => {
    const value = calcPortfolioValue(p)
    const cost = (p.positions || []).reduce((s, pos) => s + calcPositionValue(pos).cost, 0)
    const pnl = calcPortfolioPnl(p)
    const pnlPercent = cost > 0 ? (pnl / cost) * 100 : 0
    return { portfolio: p, value, cost, pnl, pnlPercent }
  })
  const bestPortfolio = portfolioPnls.reduce((best, item) =>
    !best || item.pnlPercent > best.pnlPercent ? item : best
  , null)
  const worstPortfolio = portfolioPnls.reduce((worst, item) =>
    !worst || item.pnlPercent < worst.pnlPercent ? item : worst
  , null)

  const pieData = [
    ...portfolios.map((p, i) => ({ name: p.name, value: Math.max(0, calcPortfolioValue(p)) })),
    ...(budgetTotal > 0 ? [{ name: 'Бюджет', value: budgetTotal }] : []),
  ].filter(d => d.value > 0)

  const barData = portfolios.map(p => ({
    name: p.name,
    pnl: calcPortfolioPnl(p),
  }))

  if (loading) return <div className="text-gray-500">Завантаження...</div>

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-6">Огляд</h2>

      {/* Summary Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {/* Card 1: Total Capital */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 mb-1">Загальний капітал</div>
          <div className="text-xl font-bold text-gray-800">{formatMoney(totalCapital)}</div>
          <div className="text-xs text-gray-400 mt-1.5">Бюджет: {formatMoney(budgetTotal)}</div>
        </div>

        {/* Card 2: Investments + P&L */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 mb-1">Інвестиції</div>
          <div className="text-xl font-bold text-gray-800">{formatMoney(investmentTotal)}</div>
          <div className={`text-xs mt-1.5 ${pnlColor(totalPnl)}`}>
            P&L: {formatMoney(totalPnl)} ({formatPercent(totalPnlPercent)})
          </div>
        </div>

        {/* Card 3: Best Portfolio */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 mb-1">Найкращий портфель</div>
          {bestPortfolio && portfolios.length > 1 ? (
            <>
              <div className="text-xl font-bold text-gray-800">{bestPortfolio.portfolio.name}</div>
              <div className="text-xs text-green-600 mt-1.5">
                {formatMoney(bestPortfolio.pnl)} &nbsp;{formatPercent(bestPortfolio.pnlPercent)}
              </div>
            </>
          ) : (
            <div className="text-sm text-gray-400 mt-1">—</div>
          )}
        </div>

        {/* Card 4: Worst Portfolio */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 mb-1">Найгірший портфель</div>
          {worstPortfolio && portfolios.length > 1 ? (
            <>
              <div className="text-xl font-bold text-gray-800">{worstPortfolio.portfolio.name}</div>
              <div className="text-xs text-red-600 mt-1.5">
                {formatMoney(worstPortfolio.pnl)} &nbsp;{formatPercent(worstPortfolio.pnlPercent)}
              </div>
            </>
          ) : (
            <div className="text-sm text-gray-400 mt-1">—</div>
          )}
        </div>
      </div>

      {/* Allocation with side legend */}
      {pieData.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <div className="text-sm font-semibold text-gray-700 mb-3">Розподіл капіталу</div>
          <div className="flex items-center gap-8">
            {/* Donut Chart */}
            <div className="w-48 h-48 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    dataKey="value"
                  >
                    {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => formatMoney(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Legend */}
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
              {pieData.map((item, i) => {
                const percent = totalCapital > 0
                  ? ((item.value / totalCapital) * 100).toFixed(2)
                  : '0.00'
                return (
                  <div key={item.name} className="flex items-center gap-2.5 py-1">
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: COLORS[i % COLORS.length] }}
                    />
                    <span className="text-sm font-medium text-gray-700">{item.name}</span>
                    <span className="text-sm text-gray-400 ml-auto tabular-nums">{percent}%</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Overall History Chart */}
      <PortfolioHistoryChart portfolioId={null} />

      {/* P&L by portfolios */}
      {barData.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">P&L по портфелях</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v) => formatMoney(v)} />
              <Bar dataKey="pnl" fill="#3B82F6" radius={[4, 4, 0, 0]}>
                {barData.map((entry, i) => (
                  <Cell key={i} fill={entry.pnl >= 0 ? '#10B981' : '#EF4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Portfolio list */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Портфелі</h3>
        {portfolios.length === 0 ? (
          <p className="text-gray-500 text-sm">
            Немає портфелів. <Link to="/portfolios" className="text-blue-600 hover:underline">Створити</Link>
          </p>
        ) : (
          <div className="space-y-3">
            {portfolios.map(p => {
              const val = calcPortfolioValue(p)
              const pnl = calcPortfolioPnl(p)
              return (
                <Link key={p.id} to={`/portfolios/${p.id}`} className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors">
                  <div>
                    <div className="font-medium text-gray-800">{p.name}</div>
                    <div className="text-xs text-gray-500">{(p.positions || []).length} позицій</div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium text-gray-800">{formatMoney(val)}</div>
                    <div className={`text-xs ${pnlColor(pnl)}`}>{formatMoney(pnl)}</div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
