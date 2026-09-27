import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/shared/api/client'

import type { Page, Project, ProjectInput, ProjectListItem, ProjectQuery } from './types'

export const PAGE_SIZE = 20
export const DEFAULT_QUERY: ProjectQuery = { q: '', type: '', status: '', sort: 'updated_at', order: 'desc', page: 1 }

export const projectKeys = {
  all: ['projects'] as const,
  list: (q: ProjectQuery) => ['projects', 'list', q] as const,
  detail: (id: number) => ['projects', 'detail', id] as const,
}

/** Only non-default values go into the request (and the page URL). */
export function toSearchParams(q: ProjectQuery): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(q) as [keyof ProjectQuery, ProjectQuery[keyof ProjectQuery]][]) {
    if (value !== DEFAULT_QUERY[key] && value !== '') params.set(key, String(value))
  }
  return params
}

export function useProjects(q: ProjectQuery) {
  return useQuery({
    queryKey: projectKeys.list(q),
    queryFn: ({ signal }) => {
      const params = toSearchParams(q)
      params.set('size', String(PAGE_SIZE))
      return api<Page<ProjectListItem>>(`/api/projects?${params}`, { signal })
    },
    placeholderData: keepPreviousData, // keep the current page visible while the next loads
  })
}

export function useProject(id: number | null) {
  return useQuery({
    queryKey: projectKeys.detail(id ?? 0),
    queryFn: ({ signal }) => api<Project>(`/api/projects/${id}`, { signal }),
    enabled: id !== null,
  })
}

export function useSaveProject(id: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ProjectInput) =>
      id === null
        ? api<Project>('/api/projects', { method: 'POST', body })
        : api<Project>(`/api/projects/${id}`, { method: 'PUT', body }),
    onSuccess: (project) => {
      qc.setQueryData(projectKeys.detail(project.id), project)
      void qc.invalidateQueries({ queryKey: ['projects', 'list'] })
      void qc.invalidateQueries({ queryKey: ['activity'] })
    },
  })
}

export function useDeleteProject(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>(`/api/projects/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.removeQueries({ queryKey: projectKeys.detail(id) })
      void qc.invalidateQueries({ queryKey: ['projects', 'list'] })
      void qc.invalidateQueries({ queryKey: ['activity'] })
    },
  })
}
