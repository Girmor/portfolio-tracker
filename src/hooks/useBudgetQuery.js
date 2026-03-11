import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useBudgetQuery() {
  return useQuery({
    queryKey: ['budget'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('budget')
        .select('*')
        .order('updated_at', { ascending: true })
      if (error) throw error
      return data || []
    },
  })
}

export function useCashflowQuery() {
  return useQuery({
    queryKey: ['cashflow'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('monthly_cashflow')
        .select('*')
        .order('month', { ascending: false })
      if (error) throw error
      return data || []
    },
  })
}

export function useCreateBudgetItemMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data) => {
      const { error } = await supabase.from('budget').insert(data)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['budget'] }),
  })
}

export function useUpdateBudgetItemMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }) => {
      const { error } = await supabase.from('budget').update(data).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['budget'] }),
  })
}

export function useDeleteBudgetItemMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('budget').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['budget'] }),
  })
}

export function useCreateCashflowMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data) => {
      const { error } = await supabase.from('monthly_cashflow').insert(data)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cashflow'] }),
  })
}

export function useUpdateCashflowMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }) => {
      const { error } = await supabase.from('monthly_cashflow').update(data).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cashflow'] }),
  })
}

export function useDeleteCashflowMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('monthly_cashflow').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cashflow'] }),
  })
}
