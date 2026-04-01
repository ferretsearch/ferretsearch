import { useQuery } from '@tanstack/react-query'
import { getHealth } from '../api/client.ts'

export function useHealth() {
  const result = useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    refetchInterval: 30_000,
    retry: 2,
  })

  return {
    data: result.data,
    status: result.data?.status,
    services: result.data?.services,
    isLoading: result.isLoading,
  }
}
