import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { api } from '@/shared/api/client'

import type { ActivityPage, ActivityScope } from './types'

export const ACTIVITY_PAGE_SIZE = 20

/** Everything under ['activity'] is invalidated by any module that writes history. */
export const activityKeys = {
  all: ['activity'] as const,
  scoped: (scope: ActivityScope, page: number) => ['activity', scope, page] as const,
}

export function useActivity(scope: ActivityScope, page: number, size = ACTIVITY_PAGE_SIZE) {
  return useQuery({
    queryKey: [...activityKeys.scoped(scope, page), size],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ page: String(page), size: String(size) })
      if ('all' in scope) {
        // no filter
      } else if ('projectId' in scope) params.set('project_id', String(scope.projectId))
      else {
        params.set('entity_type', scope.entityType)
        params.set('entity_id', String(scope.entityId))
      }
      return api<ActivityPage>(`/api/activity?${params}`, { signal })
    },
    placeholderData: keepPreviousData,
  })
}
