import { Link } from 'react-router-dom'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'
import { Skeleton } from './ui/skeleton'
import { formatMoney, formatPercent, pnlColor } from '../lib/formatters'
import { usePortfoliosWithPositionsQuery } from '../hooks/usePortfoliosQuery'
import { useBudgetQuery } from '../hooks/useBudgetQuery'
import { usePricesQuery } from '../hooks/usePricesQuery'
import PortfolioHistoryChart from './PortfolioHistoryChart'

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16']

function StatCardSkeleton() {
  return (
    <div className="glass-card rounded-xl p-4">
      <Skeleton className="h-3 w-1/2 mb-2" />
      <Skeleton className="h-6 w-3/4 mb-2" />
      <Skeleton className="h-3 w-1/3" />
    </div>
  )
}

export default function Overview() {
  const { data: portfolios = [], isLoading: portfoliosLoading } = usePortfoliosWithPositionsQuery()
  const { data: budget = [], isLoading: budgetLoading } = useBudgetQuery()

  const allPositions = portfolios.flatMap(p => p.positions || [])
  const { data: prices = {}, isLoading: pricesLoading } = usePricesQuery(allPositions)

  const loading = portfoliosLoading || budgetLoading

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
    return (p.positions || []).reduce((sum, pos) => sum + calcPositionValue(pos).value, 0)
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
    ...portfolios.map((p) => ({ name: p.name, value: Math.max(0, calcPortfolioValue(p)) })),
    ...(budgetTotal > 0 ? [{ name: 'Бюджет', value: budgetTotal }] : []),
  ].filter(d => d.value > 0).sort((a, b) => b.value - a.value)

  const barData = portfolios.map(p => ({
    name: p.name,
    pnl: calcPortfolioPnl(p),
  }))

  if (loading) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-white mb-6">Огляд</h2>
        <div className="grid grid-cols-2 gap-3 mb-6 lg:w-2/3">
          {[1, 2, 3, 4].map(i => <StatCardSkeleton key={i} />)}
        </div>
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">Огляд</h2>

      {/* Summary Stats + Allocation Row */}
      <div className="flex flex-col lg:flex-row gap-3 mb-6">
        {/* Stats Cards — 2/3 */}
        <div className="lg:w-2/3 grid grid-cols-2 gap-3">
          <div className="glass-card rounded-xl p-4">
            <div className="text-xs text-slate-400 mb-1">Загальний капітал</div>
            <div className="text-xl font-bold text-white">{formatMoney(totalCapital)}</div>
            <div className="text-xs text-slate-500 mt-1.5">Бюджет: {formatMoney(budgetTotal)}</div>
          </div>

          <div className="glass-card rounded-xl p-4">
            <div className="text-xs text-slate-400 mb-1">Інвестиції</div>
            <div className="text-xl font-bold text-white">{formatMoney(investmentTotal)}</div>
            <div className={`text-xs mt-1.5 ${pnlColor(totalPnl)}`}>
              P&L: {formatMoney(totalPnl)} ({formatPercent(totalPnlPercent)})
            </div>
          </div>

          <div className="glass-card rounded-xl p-4">
            <div className="text-xs text-slate-400 mb-1">Найкращий портфель</div>
            {bestPortfolio && portfolios.length > 1 ? (
              <>
                <div className="text-xl font-bold text-white">{bestPortfolio.portfolio.name}</div>
                <div className="text-xs text-green-400 mt-1.5">
                  {formatMoney(bestPortfolio.pnl)} &nbsp;{formatPercent(bestPortfolio.pnlPercent)}
                </div>
              </>
            ) : (
              <div className="text-sm text-slate-500 mt-1">—</div>
            )}
          </div>

          <div className="glass-card rounded-xl p-4">
            <div className="text-xs text-slate-400 mb-1">Найгірший портфель</div>
            {worstPortfolio && portfolios.length > 1 ? (
              <>
                <div className="text-xl font-bold text-white">{worstPortfolio.portfolio.name}</div>
                <div className="text-xs text-red-400 mt-1.5">
                  {formatMoney(worstPortfolio.pnl)} &nbsp;{formatPercent(worstPortfolio.pnlPercent)}
                </div>
              </>
            ) : (
              <div className="text-sm text-slate-500 mt-1">—</div>
            )}
          </div>
        </div>

        {/* Allocation — 1/3 */}
        {pieData.length > 0 && (
          <div className="glass-card rounded-xl p-4 lg:w-1/3 shrink-0">
            <div className="text-xs text-slate-400 mb-2">Розподіл капіталу</div>
            <div className="flex items-center justify-center gap-5">
              <div style={{ width: 128, height: 128 }} className="shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={42}
                      outerRadius={62}
                      paddingAngle={3}
                      cornerRadius={4}
                      dataKey="value"
                    >
                      {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip
                      formatter={(v) => formatMoney(v)}
                      contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#e2e8f0' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: '140px' }}>
                {pieData.map((item, i) => {
                  const percent = totalCapital > 0
                    ? ((item.value / totalCapital) * 100).toFixed(1)
                    : '0.0'
                  return (
                    <div key={item.name} className="flex items-center gap-2">
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: COLORS[i % COLORS.length] }}
                      />
                      <span className="text-sm text-slate-200 whitespace-nowrap">{item.name}</span>
                      <span className="text-sm text-slate-400 tabular-nums">{percent}%</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Overall History Chart */}
      <PortfolioHistoryChart portfolioId={null} />

      {/* P&L by portfolios */}
      {barData.length > 0 && (
        <div className="glass-card rounded-xl p-5 mb-6">
          <h3 className="text-sm font-semibold text-slate-200 mb-4">P&L по портфелях</h3>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} />
                <Tooltip
                  formatter={(v) => formatMoney(v)}
                  contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#e2e8f0' }}
                />
                <Bar dataKey="pnl" fill="#3B82F6" radius={[4, 4, 0, 0]}>
                  {barData.map((entry, i) => (
                    <Cell key={i} fill={entry.pnl >= 0 ? '#10b981' : '#f87171'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Portfolio list */}
      <div className="glass-card rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-200 mb-4">Портфелі</h3>
        {portfolios.length === 0 ? (
          <p className="text-slate-400 text-sm">
            Немає портфелів. <Link to="/portfolios" className="text-blue-400 hover:underline">Створити</Link>
          </p>
        ) : (
          <div className="space-y-1">
            {portfolios.map(p => {
              const val = calcPortfolioValue(p)
              const pnl = calcPortfolioPnl(p)
              return (
                <Link key={p.id} to={`/portfolios/${p.id}`} className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors">
                  <div>
                    <div className="font-medium text-slate-200">{p.name}</div>
                    <div className="text-xs text-slate-500">{(p.positions || []).length} позицій</div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium text-white">{formatMoney(val)}</div>
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
