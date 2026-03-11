import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useTradesQuery() {
  return useQuery({
    queryKey: ['trades'],
    queryFn: async () => {
      const [{ data: tData, error: tError }, { data: aData, error: aError }, { data: pData, error: pError }] = await Promise.all([
        supabase
          .from('trades')
          .select('*, position:positions!inner(id, ticker, name, type, portfolio_id, portfolio:portfolios!inner(id, name))')
          .order('date', { ascending: false }),
        supabase
          .from('adjustments')
          .select('*, portfolio:portfolios!inner(id, name)')
          .order('date', { ascending: false }),
        supabase.from('portfolios').select('id, name').order('name'),
      ])
      if (tError) throw tError
      if (aError) throw aError
      if (pError) throw pError
      return {
        trades: tData || [],
        adjustments: aData || [],
        portfolios: pData || [],
      }
    },
  })
}

export function useUpdateTradeMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }) => {
      const { error } = await supabase.from('trades').update(data).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trades'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio'] })
    },
  })
}

export function useDeleteTradeMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('trades').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trades'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio'] })
    },
  })
}

export function useUpdateAdjustmentMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }) => {
      const { error } = await supabase.from('adjustments').update(data).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trades'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio'] })
    },
  })
}

export function useDeleteAdjustmentMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('adjustments').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trades'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio'] })
    },
  })
}
