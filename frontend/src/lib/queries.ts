import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export const useConfig = () => useQuery({ queryKey: ['config'], queryFn: api.config, staleTime: 5 * 60_000 })
export const useMe = () => useQuery({ queryKey: ['me'], queryFn: api.me })
export const useCountries = () => useQuery({ queryKey: ['countries'], queryFn: api.countries })
export const usePremium = () => useQuery({ queryKey: ['premium'], queryFn: () => api.premium() })
export const useOrders = () => useQuery({ queryKey: ['orders'], queryFn: api.orders })
export const useCategories = () => useQuery({ queryKey: ['categories'], queryFn: api.categories, staleTime: 5 * 60_000 })

export const useSmsPrices = () => useQuery({ queryKey: ['sms-prices'], queryFn: () => api.smsPrices(), retry: false, staleTime: 60_000 })
export const useSmsActivations = () =>
  useQuery({
    queryKey: ['sms-activations'],
    queryFn: api.smsActivations,
    // poll while any activation is still in flight so the code/status update live
    refetchInterval: (q) => (q.state.data ?? []).some((a) => ['RESERVED', 'API_PENDING', 'WAITING', 'CANCEL_REQUESTED'].includes(a.status)) ? 5000 : false,
  })
