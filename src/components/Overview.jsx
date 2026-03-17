import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { PieChart, Pie, Cell, Tooltip, AreaChart, Area, ResponsiveContainer } from 'recharts'
import { Skeleton } from './ui/skeleton'
import { formatMoney, formatPercent, pnlColor } from '../lib/formatters'
import { usePortfoliosWithPositionsQuery } from '../hooks/usePortfoliosQuery'
import { useBudgetQuery } from '../hooks/useBudgetQuery'
import { usePricesQuery } from '../hooks/usePricesQuery'
import PortfolioHistoryChart from './PortfolioHistoryChart'

function currentMonth() { return new Date().toISOString().slice(0, 7) }

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

  const loading = portfoliosLoading || budgetLoading || pricesLoading

  // AVCO model — consistent with PortfolioDetail
  function calcPositionValue(pos) {
    const trades = pos.trades || []
    let totalBuyQty = 0, totalBuyCost = 0
    let totalSellQty = 0, totalSellProceeds = 0
    trades.forEach(t => {
      const qty = Number(t.quantity)
      const price = Number(t.price)
      if (t.type === 'buy') { totalBuyQty += qty; totalBuyCost += price * qty }
      else { totalSellQty += qty; totalSellProceeds += price * qty }
    })
    const avgPrice = totalBuyQty > 0 ? totalBuyCost / totalBuyQty : 0
    const remainingQty = totalBuyQty - totalSellQty
    const investedRemaining = avgPrice * remainingQty
    const currentPrice = prices[pos.ticker] ?? 0
    const value = remainingQty * currentPrice
    // Total return = unrealized + realized
    const pnl = (value + totalSellProceeds) - totalBuyCost
    return { value, cost: investedRemaining, invested: totalBuyCost, pnl }
  }

  function calcPortfolioValue(p) {
    return (p.positions || []).reduce((sum, pos) => sum + calcPositionValue(pos).value, 0)
  }

  const currentMonthKey = currentMonth()
  const currentMonthBudget = budget.filter(b => b.month === currentMonthKey)

  const budgetTotal = currentMonthBudget.reduce((sum, b) => {
    const sign = b.type === 'liability' ? -1 : 1
    if (b.currency === 'USD') return sum + sign * Number(b.amount)
    if (b.currency === 'EUR') return sum + sign * Number(b.amount) * 1.08
    if (b.currency === 'UAH') return sum + sign * Number(b.amount) / 41.5
    return sum + sign * Number(b.amount)
  }, 0)

  // Monthly net budget totals (assets − liabilities) for the mini sparkline
  const budgetMonthlyTotals = useMemo(() => {
    const map = new Map()
    for (const b of budget) {
      const sign = b.type === 'liability' ? -1 : 1
      const usd = b.currency === 'USD' ? sign * Number(b.amount)
               : b.currency === 'EUR' ? sign * Number(b.amount) * 1.08
               : sign * Number(b.amount) / 41.5
      map.set(b.month, (map.get(b.month) || 0) + usd)
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, total]) => ({ month, total }))
  }, [budget])

  const investmentTotal = portfolios.reduce((sum, p) => sum + calcPortfolioValue(p), 0)
  const totalInvested = portfolios.reduce((sum, p) =>
    sum + (p.positions || []).reduce((s, pos) => s + calcPositionValue(pos).invested, 0)
  , 0)
  const totalCapital = budgetTotal + investmentTotal
  const totalPnl = portfolios.reduce((sum, p) =>
    sum + (p.positions || []).reduce((s, pos) => s + calcPositionValue(pos).pnl, 0)
  , 0)
  const totalPnlPercent = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0

  const portfolioPnls = portfolios.map(p => {
    const value = calcPortfolioValue(p)
    const invested = (p.positions || []).reduce((s, pos) => s + calcPositionValue(pos).invested, 0)
    const pnl = (p.positions || []).reduce((s, pos) => s + calcPositionValue(pos).pnl, 0)
    const pnlPercent = invested > 0 ? (pnl / invested) * 100 : 0
    return { portfolio: p, value, invested, pnl, pnlPercent }
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
            <div className="text-xs text-slate-500 mt-1.5">
              Бюджет: <span className={budgetTotal >= 0 ? 'text-slate-400' : 'text-red-400'}>{formatMoney(budgetTotal)}</span>
            </div>
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

          {/* Budget card — full width */}
          <div className="col-span-2 glass-card rounded-xl p-4 flex items-center gap-4">
            {/* Text side */}
            <div className="min-w-0 flex-1">
              <div className="text-xs text-slate-400 mb-1">Загальний бюджет (в USD)</div>
              <div className={`text-xl font-bold ${budgetTotal >= 0 ? 'text-white' : 'text-red-400'}`}>
                {formatMoney(budgetTotal)}
              </div>
              {currentMonthBudget.length > 0 && (() => {
                const assetsByCur = {}, liabByCur = {}
                currentMonthBudget.forEach(b => {
                  if (b.type === 'liability') liabByCur[b.currency] = (liabByCur[b.currency] || 0) + Number(b.amount)
                  else assetsByCur[b.currency] = (assetsByCur[b.currency] || 0) + Number(b.amount)
                })
                return (
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5 text-xs">
                    {Object.entries(assetsByCur).map(([cur, total]) => (
                      <span key={`a-${cur}`} className="text-emerald-400">{cur}: {formatMoney(total, cur)}</span>
                    ))}
                    {Object.entries(liabByCur).map(([cur, total]) => (
                      <span key={`l-${cur}`} className="text-red-400">−{cur}: {formatMoney(total, cur)}</span>
                    ))}
                  </div>
                )
              })()}
              {currentMonthBudget.length === 0 && (
                <div className="text-xs text-slate-500 mt-1">Немає даних за поточний місяць</div>
              )}
            </div>

            {/* Mini sparkline — only when ≥2 months of data */}
            {budgetMonthlyTotals.length >= 2 && (
              <div className="shrink-0 w-40" style={{ height: 52 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={budgetMonthlyTotals} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
                    <defs>
                      <linearGradient id="budgetGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={budgetTotal >= 0 ? 'rgba(52,211,153,0.4)' : 'rgba(248,113,113,0.4)'} />
                        <stop offset="100%" stopColor="rgba(0,0,0,0)" />
                      </linearGradient>
                    </defs>
                    <Tooltip
                      formatter={(v) => [formatMoney(v), 'Бюджет']}
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.month ?? ''}
                      contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#e2e8f0', fontSize: 11 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="total"
                      stroke={budgetTotal >= 0 ? '#34d399' : '#f87171'}
                      strokeWidth={1.5}
                      fill="url(#budgetGrad)"
                      dot={false}
                      isAnimationActive={false}
                      activeDot={{ r: 3, stroke: '#1e293b', strokeWidth: 1.5 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        {/* Allocation — 1/3 */}
        {pieData.length > 0 && (
          <div className="glass-card rounded-xl p-4 lg:w-1/3 shrink-0 flex flex-col items-center justify-center">
            <div className="text-xs text-slate-400 mb-3 self-start">Розподіл капіталу</div>
            <PieChart width={200} height={200}>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={68}
                outerRadius={92}
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
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 mt-2">
              {pieData.map((item, i) => {
                const percent = totalCapital > 0
                  ? ((item.value / totalCapital) * 100).toFixed(1)
                  : '0.0'
                return (
                  <div key={item.name} className="flex items-center gap-1.5">
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: COLORS[i % COLORS.length] }}
                    />
                    <span className="text-xs text-slate-200 whitespace-nowrap">{item.name}</span>
                    <span className="text-xs text-slate-400 tabular-nums">{percent}%</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Overall History Chart */}
      <PortfolioHistoryChart portfolioId={null} positions={allPositions} currentPrices={prices} budgetItems={budget} />

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
              const pnl = (p.positions || []).reduce((s, pos) => s + calcPositionValue(pos).pnl, 0)
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
