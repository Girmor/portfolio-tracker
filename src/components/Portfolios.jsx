import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import {
  usePortfoliosQuery,
  useCreatePortfolioMutation,
  useUpdatePortfolioMutation,
  useDeletePortfolioMutation,
} from '../hooks/usePortfoliosQuery'

const schema = z.object({
  name: z.string().min(1, "Назва обов'язкова"),
  description: z.string().optional(),
})

function PortfolioSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
      <div className="h-5 bg-gray-200 rounded w-2/3 mb-3" />
      <div className="h-3 bg-gray-100 rounded w-1/2 mb-3" />
      <div className="h-3 bg-gray-100 rounded w-1/4" />
    </div>
  )
}

export default function Portfolios() {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)

  const { data: portfolios = [], isLoading } = usePortfoliosQuery()
  const createMutation = useCreatePortfolioMutation()
  const updateMutation = useUpdatePortfolioMutation()
  const deleteMutation = useDeletePortfolioMutation()

  const { register, handleSubmit, reset, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { name: '', description: '' },
  })

  async function onSubmit(values) {
    try {
      if (editingId) {
        await updateMutation.mutateAsync({ id: editingId, data: values })
        toast.success('Портфель оновлено')
      } else {
        await createMutation.mutateAsync(values)
        toast.success('Портфель створено')
      }
      reset()
      setShowForm(false)
      setEditingId(null)
    } catch (err) {
      toast.error(err.message)
    }
  }

  function startEdit(p) {
    setEditingId(p.id)
    reset({ name: p.name, description: p.description || '' })
    setShowForm(true)
  }

  async function handleDelete(id) {
    if (!confirm('Видалити цей портфель?')) return
    try {
      await deleteMutation.mutateAsync(id)
      toast.success('Портфель видалено')
    } catch (err) {
      toast.error(err.message)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Портфелі</h2>
        <button
          onClick={() => { setShowForm(true); setEditingId(null); reset({ name: '', description: '' }) }}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          + Новий портфель
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <h3 className="font-semibold text-gray-700 mb-3">
            {editingId ? 'Редагувати портфель' : 'Новий портфель'}
          </h3>
          <div className="flex gap-3 items-start">
            <div className="flex-1">
              <label className="block text-sm text-gray-600 mb-1">Назва</label>
              <input
                {...register('name')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Довгострокові акції"
              />
              {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
            </div>
            <div className="flex-1">
              <label className="block text-sm text-gray-600 mb-1">Опис</label>
              <input
                {...register('description')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Акції на 5+ років"
              />
            </div>
            <div className="flex gap-2 pt-6">
              <button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
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
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <PortfolioSkeleton key={i} />)}
        </div>
      ) : portfolios.length === 0 ? (
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
