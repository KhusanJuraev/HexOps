import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'

import { sessionKey } from '@/features/auth'
import { healthKey } from '@/features/connection'
import { ApiError, isUnreachable } from '@/shared/api/client'

export function createQueryClient() {
  // Any request that could not reach HexOps triggers an immediate health re-check,
  // so the connection indicator reflects it without waiting for the next probe.
  const recheckHealth = (error: unknown) => {
    if (isUnreachable(error)) void client.invalidateQueries({ queryKey: healthKey, exact: true })
  }

  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        // A 401 from any private query means the session ended: drop to the login screen.
        // An unreachable backend is not a 401 and never signs the user out.
        if (error instanceof ApiError && error.status === 401 && query.queryKey !== sessionKey) {
          client.setQueryData(sessionKey, null)
        }
        // Compare by value: a failing health probe must never re-trigger itself.
        if (query.queryKey[0] !== healthKey[0]) recheckHealth(error)
      },
    }),
    mutationCache: new MutationCache({ onError: recheckHealth }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Retry only unexpected server errors. Client errors will not change, and outages
        // are re-checked by the health probe, which refetches failed queries on recovery.
        retry: (count, error) =>
          error instanceof ApiError && error.status >= 500 && error.code === 'internal_error' && count < 2,
        // The API is on loopback: the browser's online/offline flag says nothing about it.
        networkMode: 'always',
      },
      mutations: { retry: false, networkMode: 'always' },
    },
  })
  return client
}
