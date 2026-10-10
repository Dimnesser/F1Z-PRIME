import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export const useConfig = () => useQuery({ queryKey: ['config'], queryFn: api.config, staleTime: 5 * 60_000 })
export const useMe = () => useQuery({ queryKey: ['me'], queryFn: api.me })
export const useCountries = () => useQuery({ queryKey: ['countries'], queryFn: api.countries })
export const usePremium = () => useQuery({ queryKey: ['premium'], queryFn: () => api.premium() })
export const useOrders = () => useQuery({ queryKey: ['orders'], queryFn: api.orders })
