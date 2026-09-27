import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { activityKeys } from '@/features/activity'
import { api } from '@/shared/api/client'

import type {
  Attachment,
  Page,
  ProjectOption,
  Report,
  ReportInput,
  ReportListItem,
  ReportQuery,
  ReportStatus,
} from './types'

export const PAGE_SIZE = 20
export const DEFAULT_QUERY: ReportQuery = {
  q: '',
  project_id: null,
  type: '',
  severity: '',
  status: '',
  created_from: '',
  created_to: '',
  sort: 'updated_at',
  order: 'desc',
  page: 1,
}

export const reportKeys = {
  all: ['reports'] as const,
  list: (q: ReportQuery) => ['reports', 'list', q] as const,
  detail: (id: number) => ['reports', 'detail', id] as const,
  attachments: (id: number) => ['reports', 'attachments', id] as const,
}

/** Only non-default values go into the request (and the page URL). */
export function toSearchParams(q: ReportQuery): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(q) as [keyof ReportQuery, ReportQuery[keyof ReportQuery]][]) {
    if (value !== DEFAULT_QUERY[key] && value !== '' && value !== null) params.set(key, String(value))
  }
  return params
}

export function useReports(q: ReportQuery, size = PAGE_SIZE) {
  return useQuery({
    queryKey: [...reportKeys.list(q), size],
    queryFn: ({ signal }) => {
      const params = toSearchParams(q)
      params.set('size', String(size))
      return api<Page<ReportListItem>>(`/api/reports?${params}`, { signal })
    },
    placeholderData: keepPreviousData,
  })
}

export function useReport(id: number | null) {
  return useQuery({
    queryKey: reportKeys.detail(id ?? 0),
    queryFn: ({ signal }) => api<Report>(`/api/reports/${id}`, { signal }),
    enabled: id !== null,
  })
}

/**
 * Projects to link a report to. Uses the Projects HTTP API (its public contract),
 * not the projects feature's code, so the two features do not import each other.
 */
export function useProjectOptions(search: string) {
  return useQuery({
    queryKey: ['projects', 'options', search],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ sort: 'name', order: 'asc', size: '100' })
      if (search.trim()) params.set('q', search.trim())
      return api<Page<ProjectOption>>(`/api/projects?${params}`, { signal })
    },
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })
}

function useInvalidate() {
  const qc = useQueryClient()
  return (report?: Report) => {
    if (report) qc.setQueryData(reportKeys.detail(report.id), report)
    void qc.invalidateQueries({ queryKey: ['reports', 'list'] })
    void qc.invalidateQueries({ queryKey: activityKeys.all })
  }
}

export function useSaveReport(id: number | null) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (body: ReportInput) =>
      id === null
        ? api<Report>('/api/reports', { method: 'POST', body })
        : api<Report>(`/api/reports/${id}`, { method: 'PUT', body }),
    onSuccess: invalidate,
  })
}

export function useChangeStatus(id: number) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (body: { to: ReportStatus; correction?: boolean; at?: string }) =>
      api<Report>(`/api/reports/${id}/status`, { method: 'POST', body }),
    onSuccess: invalidate,
  })
}

export function useDeleteReport(id: number) {
  const qc = useQueryClient()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: () => api<void>(`/api/reports/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.removeQueries({ queryKey: reportKeys.detail(id) })
      invalidate()
    },
  })
}

export function useAttachments(reportId: number) {
  return useQuery({
    queryKey: reportKeys.attachments(reportId),
    queryFn: ({ signal }) => api<Attachment[]>(`/api/reports/${reportId}/attachments`, { signal }),
  })
}

export function useUploadAttachment(reportId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api<Attachment>(`/api/reports/${reportId}/attachments`, { method: 'POST', body: form })
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: reportKeys.attachments(reportId) })
      void qc.invalidateQueries({ queryKey: activityKeys.all })
    },
  })
}

export function useDeleteAttachment(reportId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (attachmentId: number) =>
      api<void>(`/api/reports/${reportId}/attachments/${attachmentId}`, { method: 'DELETE' }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: reportKeys.attachments(reportId) })
      void qc.invalidateQueries({ queryKey: activityKeys.all })
    },
  })
}

export const downloadUrl = (reportId: number, attachmentId: number) =>
  `/api/reports/${reportId}/attachments/${attachmentId}/download`

export interface EvidenceLimits {
  max_bytes: number
  max_files: number
}

/** The server's configured evidence limits (HEXOPS_MAX_UPLOAD_BYTES …), shown in the UI. */
export function useEvidenceLimits() {
  return useQuery({
    queryKey: ['reports', 'evidence-limits'],
    queryFn: ({ signal }) => api<EvidenceLimits>('/api/reports/evidence-limits', { signal }),
    staleTime: Infinity,
  })
}
