import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useImportsQuery() {
  return useQuery({
    queryKey: ['imports'],
    queryFn: async () => {
      const [{ data: iData, error: iError }, { data: pData, error: pError }] = await Promise.all([
        supabase
          .from('imports')
          .select('*, portfolio:portfolios(id, name)')
          .order('imported_at', { ascending: false }),
        supabase
          .from('portfolios')
          .select('*, positions(id)')
          .order('created_at', { ascending: true }),
      ])
      if (iError) throw iError
      if (pError) throw pError
      return {
        imports: iData || [],
        portfolios: pData || [],
      }
    },
  })
}

export function useRefreshImports() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: ['imports'] })
    queryClient.invalidateQueries({ queryKey: ['portfolios'] })   // list page position counts
    queryClient.invalidateQueries({ queryKey: ['portfolio'] })    // detail page
    queryClient.invalidateQueries({ queryKey: ['trades'] })
    queryClient.invalidateQueries({ queryKey: ['dividends'] })
  }
}
