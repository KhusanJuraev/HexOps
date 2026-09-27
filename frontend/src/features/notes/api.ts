import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { activityKeys } from '@/features/activity'
import { api } from '@/shared/api/client'
import type { SelectOption } from '@/shared/components/SearchSelect'

import type { Note, NoteInput, NoteListItem, NoteQuery, Page, TagCount } from './types'

export const PAGE_SIZE = 20
export const DEFAULT_QUERY: NoteQuery = { q: '', tag: [], project_id: null, sort: 'updated_at', order: 'desc', page: 1 }

export const noteKeys = {
  list: (q: NoteQuery, size: number) => ['notes', 'list', q, size] as const,
  detail: (id: number) => ['notes', 'detail', id] as const,
  tags: ['notes', 'tags'] as const,
}

/** Only non-default values go into the request (and the page URL). Tags repeat. */
export function toSearchParams(q: NoteQuery): URLSearchParams {
  const params = new URLSearchParams()
  if (q.q) params.set('q', q.q)
  for (const tag of q.tag) params.append('tag', tag)
  if (q.project_id !== null) params.set('project_id', String(q.project_id))
  if (q.sort !== DEFAULT_QUERY.sort) params.set('sort', q.sort)
  if (q.order !== DEFAULT_QUERY.order) params.set('order', q.order)
  if (q.page !== 1) params.set('page', String(q.page))
  return params
}

export function useNotes(q: NoteQuery, size = PAGE_SIZE) {
  return useQuery({
    queryKey: noteKeys.list(q, size),
    queryFn: ({ signal }) => {
      const params = toSearchParams(q)
      params.set('size', String(size))
      return api<Page<NoteListItem>>(`/api/notes?${params}`, { signal })
    },
    placeholderData: keepPreviousData,
  })
}

export function useNote(id: number | null) {
  return useQuery({
    queryKey: noteKeys.detail(id ?? 0),
    queryFn: ({ signal }) => api<Note>(`/api/notes/${id}`, { signal }),
    enabled: id !== null,
  })
}

export function useTags() {
  return useQuery({
    queryKey: noteKeys.tags,
    queryFn: ({ signal }) => api<TagCount[]>('/api/notes/tags', { signal }),
    staleTime: 60_000,
  })
}

/** Projects to link a note to, via the Projects HTTP API (no feature import cycle). */
export function useProjectOptions(search: string) {
  return useQuery({
    queryKey: ['projects', 'options', search],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ sort: 'name', order: 'asc', size: '100' })
      if (search.trim()) params.set('q', search.trim())
      return api<Page<SelectOption>>(`/api/projects?${params}`, { signal })
    },
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })
}

function useInvalidate() {
  const qc = useQueryClient()
  return (note?: Note) => {
    if (note) qc.setQueryData(noteKeys.detail(note.id), note)
    void qc.invalidateQueries({ queryKey: ['notes', 'list'] })
    void qc.invalidateQueries({ queryKey: noteKeys.tags })
    void qc.invalidateQueries({ queryKey: activityKeys.all })
  }
}

export function useSaveNote(id: number | null) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (body: NoteInput) =>
      id === null ? api<Note>('/api/notes', { method: 'POST', body }) : api<Note>(`/api/notes/${id}`, { method: 'PUT', body }),
    onSuccess: invalidate,
  })
}

export function useDeleteNote(id: number) {
  const qc = useQueryClient()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: () => api<void>(`/api/notes/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.removeQueries({ queryKey: noteKeys.detail(id) })
      invalidate()
    },
  })
}
