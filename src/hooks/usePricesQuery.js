import { useQuery } from '@tanstack/react-query'
import { getPricesFromServer } from '../lib/priceService'

export function usePricesQuery(positions) {
  return useQuery({
    queryKey: ['prices', positions?.map(p => p.ticker).sort()],
    queryFn: async () => {
      if (!positions || positions.length === 0) return {}
      return getPricesFromServer(positions)
    },
    enabled: !!positions && positions.length > 0,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
}
