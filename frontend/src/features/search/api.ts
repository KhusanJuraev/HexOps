import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { api } from '@/shared/api/client'

export type SearchKind = 'all' | 'report' | 'note'
export const PAGE_SIZE = 20

export interface SearchHit {
  kind: 'report' | 'note'
  id: number
  title: string
  snippet: string
  project_id: number | null
  project_name: string | null
  updated_at: string
  severity: string | null
  status: string | null
  tags: string[] | null
}

export interface SearchPage {
  items: SearchHit[]
  total: number
  page: number
  size: number
  terms: string[]
}

export interface SearchParams {
  q: string
  kind: SearchKind
  tag: string[]
  page: number
}

/** Server-side search; nothing runs for an empty query. One page at a time. */
export function useSearch(p: SearchParams) {
  return useQuery({
    queryKey: ['search', p],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ q: p.q, size: String(PAGE_SIZE) })
      if (p.kind !== 'all') params.set('kind', p.kind)
      for (const t of p.tag) params.append('tag', t)
      if (p.page > 1) params.set('page', String(p.page))
      return api<SearchPage>(`/api/search?${params}`, { signal })
    },
    enabled: p.q.trim().length > 0,
    placeholderData: keepPreviousData,
  })
}

/** Note tags for the filter, via the Notes HTTP API (no feature import). */
export function useNoteTags() {
  return useQuery({
    queryKey: ['notes', 'tags'],
    queryFn: ({ signal }) => api<{ name: string; count: number }[]>('/api/notes/tags', { signal }),
    staleTime: 60_000,
  })
}
