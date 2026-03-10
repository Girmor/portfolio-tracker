import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { supabase } from '../lib/supabase'
import { formatMoney, formatDate } from '../lib/formatters'
import { getCryptoPrices, getStockPrices, getCoinId } from '../lib/priceService'

export default function Snapshots() {
  const [snapshots, setSnapshots] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchSnapshots()
    autoSnapshot()
  }, [])

  async function fetchSnapshots() {
    setLoading(true)
    const { data } = await supabase.from('snapshots').select('*').order('created_at', { ascending: false })
    setSnapshots(data || [])
    setLoading(false)
  }

  async function autoSnapshot() {
    const today = new Date().toISOString().split('T')[0]
    const { data: existing } = await supabase
      .from('snapshots')
      .select('id')
      .gte('created_at', today + 'T00:00:00')
      .lte('created_at', today + 'T23:59:59')
      .limit(1)
    if (existing && existing.length > 0) return

    await saveSnapshot(`Авто ${today}`)
    fetchSnapshots()
  }

  async function saveSnapshot(label) {
    setSaving(true)
    const [{ data: positions }, { data: trades }, { data: budget }, { data: portfolios }] = await Promise.all([
      supabase.from('positions').select('*'),
      supabase.from('trades').select('*'),
      supabase.from('budget').select('*'),
      supabase.from('portfolios').select('*'),
    ])

    const budgetTotal = (budget || []).reduce((sum, b) => {
      if (b.currency === 'USD') return sum + Number(b.amount)
      if (b.currency === 'EUR') return sum + Number(b.amount) * 1.08
      if (b.currency === 'UAH') return sum + Number(b.amount) / 41.5
      return sum + Number(b.amount)
    }, 0)

    // Fetch current prices for all positions
    const allPositions = positions || []
    const allTrades = trades || []
    const cryptoPositions = allPositions.filter(p => p.type === 'crypto')
    const stockPositions = allPositions.filter(p => p.type === 'stock')

    const [cryptoPrices, stockPrices] = await Promise.all([
      cryptoPositions.length ? getCryptoPrices(cryptoPositions.map(p => getCoinId(p))) : {},
      stockPositions.length ? getStockPrices(stockPositions.map(p => p.ticker)) : {},
    ])

    const priceMap = {}
    cryptoPositions.forEach(p => {
      const price = cryptoPrices[getCoinId(p)]
      if (price != null) priceMap[p.ticker] = price
    })
    stockPositions.forEach(p => {
      const price = stockPrices[p.ticker]
      if (price != null) priceMap[p.ticker] = price
    })

    // Compute per-portfolio totals
    const byPortfolio = {}
    let overallValue = 0, overallCost = 0

    for (const pf of (portfolios || [])) {
      const pfPositions = allPositions.filter(p => p.portfolio_id === pf.id)
      let pfValue = Number(pf.cash_balance) || 0
      let pfCost = 0

      for (const pos of pfPositions) {
        const posTrades = allTrades.filter(t => t.position_id === pos.id)
        let buyQty = 0, buyCost = 0, sellQty = 0
        posTrades.forEach(t => {
          const qty = Number(t.quantity), price = Number(t.price)
          if (t.type === 'buy') { buyQty += qty; buyCost += price * qty }
          else { sellQty += qty }
        })
        const remainQty = buyQty - sellQty
        const avgPrice = buyQty > 0 ? buyCost / buyQty : 0
        const invested = avgPrice * remainQty
        const currentPrice = priceMap[pos.ticker] ?? 0
        const mktValue = remainQty * currentPrice

        if (remainQty > 0) {
          pfValue += mktValue
          pfCost += invested
        }
      }

      const pfPnl = pfValue - pfCost - (Number(pf.cash_balance) || 0)
      const pfPnlPercent = pfCost > 0 ? (pfPnl / pfCost) * 100 : 0
      byPortfolio[pf.id] = { totalValue: pfValue, totalCost: pfCost, totalPnl: pfPnl, totalPnlPercent: pfPnlPercent }
      overallValue += pfValue
      overallCost += pfCost
    }

    const overallPnl = overallValue - overallCost
    const overallPnlPercent = overallCost > 0 ? (overallPnl / overallCost) * 100 : 0

    await supabase.from('snapshots').insert({
      label: label || `Снепшот ${new Date().toLocaleString('uk-UA')}`,
      data: {
        positions: allPositions,
        trades: allTrades,
        budget: budget || [],
        portfolios: portfolios || [],
        budgetTotalUsd: budgetTotal,
        computed: {
          byPortfolio,
          overall: { totalValue: overallValue, totalCost: overallCost, totalPnl: overallPnl, totalPnlPercent: overallPnlPercent },
          prices: priceMap,
        },
      },
    })
    setSaving(false)
    fetchSnapshots()
  }

  async function handleDelete(id) {
    if (!confirm('Видалити цей снепшот?')) return
    await supabase.from('snapshots').delete().eq('id', id)
    fetchSnapshots()
  }

  const chartData = [...snapshots]
    .reverse()
    .map(s => ({
      date: formatDate(s.created_at),
      budget: s.data?.budgetTotalUsd || 0,
    }))

  if (loading) return <div className="text-gray-500">Завантаження...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Снепшоти</h2>
        <button
          onClick={() => saveSnapshot()}
          disabled={saving}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Збереження...' : 'Зберегти снепшот'}
        </button>
      </div>

      {chartData.length > 1 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h3 className="font-semibold text-gray-700 mb-4">Бюджет з часом</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v) => formatMoney(v)} />
              <Line type="monotone" dataKey="budget" stroke="#3B82F6" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {snapshots.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg mb-2">Немає снепшотів</p>
          <p className="text-sm">Снепшоти зберігаються автоматично раз на день</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left py-3 px-4 font-medium text-gray-600">Дата</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">Мітка</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">Бюджет (USD)</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">Позицій</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">Дії</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map(s => (
                <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-3 px-4 text-gray-700">{formatDate(s.created_at)}</td>
                  <td className="py-3 px-4 text-gray-800">{s.label}</td>
                  <td className="text-right py-3 px-4 text-gray-700">{formatMoney(s.data?.budgetTotalUsd)}</td>
                  <td className="text-right py-3 px-4 text-gray-700">{s.data?.positions?.length || 0}</td>
                  <td className="text-right py-3 px-4">
                    <button onClick={() => handleDelete(s.id)} className="text-red-500 hover:text-red-700 text-xs">
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
