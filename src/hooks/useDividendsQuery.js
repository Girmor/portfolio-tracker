import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useDividendsQuery() {
  return useQuery({
    queryKey: ['dividends'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dividends')
        .select('*')
        .order('date', { ascending: false })
      if (error) throw error
      return data || []
    },
  })
}

export function useCreateDividendMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data) => {
      const { error } = await supabase.from('dividends').insert(data)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dividends'] })
    },
  })
}

export function useDeleteDividendMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('dividends').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dividends'] })
    },
  })
}
