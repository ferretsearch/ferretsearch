import { useQuery } from '@tanstack/react-query'
import { search } from '../api/client.ts'

export function useSearch(query: string, filters?: { sourceType?: string }) {
  const result = useQuery({
    queryKey: ['search', query, filters],
    queryFn: () => search(query, { filters }),
    enabled: query.length >= 2,
    staleTime: 30_000,
  })

  return {
    results: result.data?.results ?? [],
    took: result.data?.took,
    total: result.data?.total ?? 0,
    isLoading: result.isLoading,
    isFetching: result.isFetching,
    error: result.error,
  }
}
