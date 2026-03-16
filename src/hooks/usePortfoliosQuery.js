import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { resolveMissingCoinIds } from '../lib/priceService'

export function usePortfoliosQuery() {
  return useQuery({
    queryKey: ['portfolios'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('*, positions(id, ticker, type)')
        .order('created_at', { ascending: true })
      if (error) throw error
      return data || []
    },
  })
}

export function usePortfoliosWithPositionsQuery() {
  return useQuery({
    queryKey: ['portfolios', 'with-positions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('*, positions(*, trades(*))')
        .order('created_at', { ascending: true })
      if (error) throw error
      const all = data || []
      const allPositions = all.flatMap(p => p.positions || [])
      const resolved = await resolveMissingCoinIds(allPositions, supabase)
      return all.map(p => ({
        ...p,
        positions: (p.positions || []).map(pos => resolved.find(r => r.id === pos.id) || pos),
      }))
    },
  })
}

export function usePortfolioDetailQuery(id) {
  return useQuery({
    queryKey: ['portfolio', id],
    queryFn: async () => {
      const [{ data: pData, error: pError }, { data: posData, error: posError }] = await Promise.all([
        supabase.from('portfolios').select('*').eq('id', id).single(),
        supabase.from('positions').select('*, trades(*)').eq('portfolio_id', id).order('created_at', { ascending: true }),
      ])
      if (pError) throw pError
      if (posError) throw posError
      const positions = posData || []
      const resolved = await resolveMissingCoinIds(positions, supabase)
      return { portfolio: pData, positions: resolved }
    },
    enabled: !!id,
  })
}

export function useCreatePortfolioMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data) => {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase.from('portfolios').insert({ ...data, user_id: user.id })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolios'] })
    },
  })
}

export function useUpdatePortfolioMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }) => {
      const { error } = await supabase.from('portfolios').update(data).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolios'] })
    },
  })
}

export function useDeletePortfolioMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('portfolios').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolios'] })
    },
  })
}

export function useAddPositionMutation(portfolioId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data) => {
      const { error } = await supabase.from('positions').insert(data)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio', portfolioId] })
      queryClient.invalidateQueries({ queryKey: ['portfolios'] })
    },
  })
}

export function useDeletePositionMutation(portfolioId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (posId) => {
      await supabase.from('trades').delete().eq('position_id', posId)
      const { error } = await supabase.from('positions').delete().eq('id', posId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio', portfolioId] })
      queryClient.invalidateQueries({ queryKey: ['portfolios'] })
    },
  })
}

export function useAddTradeMutation(portfolioId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data) => {
      const { error } = await supabase.from('trades').insert(data)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio', portfolioId] })
      queryClient.invalidateQueries({ queryKey: ['trades'] })
    },
  })
}

export function useCashAdjustmentMutation(portfolioId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ previousBalance, newBalance, date }) => {
      const { error: adjError } = await supabase.from('adjustments').insert({
        portfolio_id: portfolioId,
        previous_balance: previousBalance,
        new_balance: newBalance,
        date,
      })
      if (adjError) throw adjError
      const { error: updateError } = await supabase
        .from('portfolios')
        .update({ cash_balance: newBalance })
        .eq('id', portfolioId)
      if (updateError) throw updateError
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio', portfolioId] })
      queryClient.invalidateQueries({ queryKey: ['portfolios'] })
      queryClient.invalidateQueries({ queryKey: ['trades'] })
    },
  })
}
