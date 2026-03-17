import { useEffect } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { toast } from 'sonner'
import { formatMoney, formatDate } from '../lib/formatters'
import { useSnapshotsQuery, useDeleteSnapshotMutation, useSaveSnapshotMutation } from '../hooks/useSnapshotsQuery'
import { supabase } from '../lib/supabase'
import { Trash2 } from 'lucide-react'

export default function Snapshots() {
  const { data: snapshots = [], isLoading } = useSnapshotsQuery()
  const deleteSnapshot = useDeleteSnapshotMutation()
  const saveSnapshot = useSaveSnapshotMutation()

  useEffect(() => {
    async function autoSnapshot() {
      const today = new Date().toISOString().split('T')[0]
      const { data: existing } = await supabase
        .from('snapshots')
        .select('id')
        .gte('created_at', today + 'T00:00:00')
        .lte('created_at', today + 'T23:59:59')
        .limit(1)
      if (existing && existing.length > 0) return
      saveSnapshot.mutate(`Авто ${today}`)
    }
    autoSnapshot()
  }, [])

  async function handleSave() {
    try {
      await saveSnapshot.mutateAsync()
      toast.success('Снепшот збережено')
    } catch (err) {
      toast.error(err.message || 'Помилка збереження')
    }
  }

  async function handleDelete(id) {
    if (!confirm('Видалити цей снепшот?')) return
    try {
      await deleteSnapshot.mutateAsync(id)
      toast.success('Снепшот видалено')
    } catch (err) {
      toast.error(err.message)
    }
  }

  const chartData = [...snapshots]
    .reverse()
    .map(s => ({
      date: new Date(s.created_at).getTime(),
      budget: s.data?.budgetTotalUsd || 0,
    }))

  const tooltipStyle = {
    background: '#1e293b',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8,
    color: '#e2e8f0',
  }

  if (isLoading) {
    return (
      <div className="animate-pulse">
        <div className="flex items-center justify-between mb-6">
          <div className="h-8 bg-white/10 rounded w-36" />
          <div className="h-9 bg-white/10 rounded w-40" />
        </div>
        <div className="glass-card rounded-xl h-64 mb-6" />
        <div className="glass-card rounded-xl h-48" />
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Снепшоти</h2>
        <button
          onClick={handleSave}
          disabled={saveSnapshot.isPending}
          className="btn btn-primary"
        >
          {saveSnapshot.isPending ? 'Збереження...' : 'Зберегти снепшот'}
        </button>
      </div>

      {chartData.length > 1 && (
        <div className="glass-card rounded-xl p-5 mb-6">
          <h3 className="font-semibold text-slate-200 mb-4">Бюджет з часом</h3>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="snapshotGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(59,130,246,0.35)" />
                    <stop offset="100%" stopColor="rgba(59,130,246,0)" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" />
                <XAxis
                  dataKey="date"
                  type="number"
                  scale="time"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(ts) => new Date(ts).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' })}
                  tick={{ fontSize: 12, fill: '#94a3b8' }}
                />
                <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} />
                <Tooltip
                  formatter={(v) => [formatMoney(v), 'Бюджет']}
                  labelFormatter={(ts) => new Date(ts).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  contentStyle={tooltipStyle}
                />
                <Area
                  type="monotone"
                  dataKey="budget"
                  stroke="#60a5fa"
                  fill="url(#snapshotGrad)"
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#60a5fa', stroke: '#1e293b', strokeWidth: 1.5 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {snapshots.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <p className="text-lg mb-2">Немає снепшотів</p>
          <p className="text-sm">Снепшоти зберігаються автоматично раз на день</p>
        </div>
      ) : (
        <div className="glass-card rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="text-left py-3 px-4 font-medium text-slate-300">Дата</th>
                <th className="text-left py-3 px-4 font-medium text-slate-300">Мітка</th>
                <th className="text-right py-3 px-4 font-medium text-slate-300">Бюджет (USD)</th>
                <th className="text-right py-3 px-4 font-medium text-slate-300">Позицій</th>
                <th className="text-right py-3 px-4 font-medium text-slate-300">Дії</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map(s => (
                <tr key={s.id} className="border-b border-white/[0.06] hover:bg-white/5">
                  <td className="py-3 px-4 text-slate-200">{formatDate(s.created_at)}</td>
                  <td className="py-3 px-4 text-slate-200">{s.label}</td>
                  <td className="text-right py-3 px-4 text-slate-200">{formatMoney(s.data?.budgetTotalUsd)}</td>
                  <td className="text-right py-3 px-4 text-slate-200">{s.data?.positions?.length || 0}</td>
                  <td className="text-right py-3 px-4">
                    <button onClick={() => handleDelete(s.id)} className="text-red-400 hover:text-red-300 text-xs transition-colors">
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
