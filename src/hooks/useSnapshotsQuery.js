import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useSnapshotsQuery() {
  return useQuery({
    queryKey: ['snapshots'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('snapshots')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })
}

export function useDeleteSnapshotMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('snapshots').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['snapshots'] }),
  })
}

export function useSaveSnapshotMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (label) => {
      const { error } = await supabase.functions.invoke('recalc-snapshots', {
        body: { label: label || `Снепшот ${new Date().toLocaleString('uk-UA')}` },
      })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['snapshots'] }),
  })
}
