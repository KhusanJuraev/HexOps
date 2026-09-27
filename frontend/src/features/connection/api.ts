import { useQuery } from '@tanstack/react-query'

import { api, ApiError } from '@/shared/api/client'

export const healthKey = ['health'] as const

/**
 * checking — first probe in flight
 * online   — API and database answer
 * database — API answers, PostgreSQL does not
 * offline  — no HexOps API answered at all
 */
export type ConnectionState = 'checking' | 'online' | 'database' | 'offline'

// While unreachable, re-check with one small request every 15 s. A healthy
// connection is never polled; it is re-checked whenever the tab regains focus.
const RETRY_WHILE_DOWN_MS = 15_000

export function useConnection() {
  const query = useQuery({
    queryKey: healthKey,
    queryFn: ({ signal }) => api<{ status: 'ok' }>('/api/health', { signal }),
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: true,
    refetchInterval: (q) => (q.state.status === 'error' ? RETRY_WHILE_DOWN_MS : false),
  })

  let state: ConnectionState = 'checking'
  if (query.isError) {
    state = query.error instanceof ApiError && query.error.code === 'database_unavailable' ? 'database' : 'offline'
  } else if (query.isSuccess) {
    state = 'online'
  }
  return { state, recheck: () => void query.refetch(), isRechecking: query.isFetching }
}
