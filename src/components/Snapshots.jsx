import { useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { toast } from 'sonner'
import { formatMoney, formatDate } from '../lib/formatters'
import { useSnapshotsQuery, useDeleteSnapshotMutation, useSaveSnapshotMutation } from '../hooks/useSnapshotsQuery'
import { supabase } from '../lib/supabase'

export default function Snapshots() {
  const { data: snapshots = [], isLoading } = useSnapshotsQuery()
  const deleteSnapshot = useDeleteSnapshotMutation()
  const saveSnapshot = useSaveSnapshotMutation()

  // Auto-snapshot once per day
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
      date: formatDate(s.created_at),
      budget: s.data?.budgetTotalUsd || 0,
    }))

  if (isLoading) {
    return (
      <div className="animate-pulse">
        <div className="flex items-center justify-between mb-6">
          <div className="h-8 bg-gray-200 rounded w-36" />
          <div className="h-9 bg-gray-200 rounded w-40" />
        </div>
        <div className="bg-white rounded-xl border border-gray-200 h-64 mb-6" />
        <div className="bg-white rounded-xl border border-gray-200 h-48" />
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Снепшоти</h2>
        <button
          onClick={handleSave}
          disabled={saveSnapshot.isPending}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {saveSnapshot.isPending ? 'Збереження...' : 'Зберегти снепшот'}
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
