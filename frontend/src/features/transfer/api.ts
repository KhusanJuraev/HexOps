import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/shared/api/client'

export type TransferStatus = 'queued' | 'running' | 'validated' | 'done' | 'failed'

export interface Summary {
  created_at: string
  app_version: string
  schema_version: string
  source_owner?: string
  counts: Record<string, number>
  files: number
  file_bytes: number
}

export interface TransferJob {
  id: number
  kind: 'export' | 'import'
  status: TransferStatus
  stage: string
  progress: number
  archive_size: number | null
  original_name: string | null
  preview: {
    source?: Summary
    target?: { counts: Record<string, number>; populated: boolean }
    space?: { needed_bytes: number; free_bytes: number }
  } | null
  backup_name: string | null
  error_code: string | null
  created_at: string
  finished_at: string | null
  expires_at: string
  download_name: string | null
}

export interface TransferState {
  counts: Record<string, number>
  populated: boolean
  busy: boolean
  max_archive_bytes: number
}

/** The record kinds shown to the owner, in order (tables in the archive). */
export const COUNTED = ['projects', 'project_scope_items', 'reports', 'report_attachments', 'notes', 'tags', 'activity_logs'] as const
export const MIN_PASSPHRASE = 12
const LONG_POLL_SECONDS = 20

export const transferKeys = {
  state: ['transfer', 'state'] as const,
  job: (id: number) => ['transfer', 'job', id] as const,
}

export const isWorking = (job: TransferJob | undefined) => job?.status === 'queued' || job?.status === 'running'

export function useTransferState() {
  return useQuery({
    queryKey: transferKeys.state,
    queryFn: ({ signal }) => api<TransferState>('/api/transfer/state', { signal }),
  })
}

/** Follows a job with long polls (the server answers when it changes). */
export function useTransferJob(id: number | null) {
  return useQuery({
    queryKey: transferKeys.job(id ?? 0),
    enabled: id !== null,
    queryFn: ({ signal }) => api<TransferJob>(`/api/transfer/jobs/${id}?wait=${LONG_POLL_SECONDS}`, { signal }),
    refetchInterval: (q) => (isWorking(q.state.data) ? 50 : false),
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  })
}

function useStart<T>(request: (input: T) => Promise<TransferJob>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: request,
    onSuccess: (job) => qc.setQueryData(transferKeys.job(job.id), job),
  })
}

export const useCreateExport = () =>
  useStart((passphrase: string) => api<TransferJob>('/api/transfer/exports', { method: 'POST', body: { passphrase } }))

export const useUploadImport = () =>
  useStart(({ file, passphrase }: { file: File; passphrase: string }) => {
    const form = new FormData()
    form.append('passphrase', passphrase)
    form.append('file', file)
    return api<TransferJob>('/api/transfer/imports', { method: 'POST', body: form })
  })

export const useCheckAgain = () =>
  useStart(({ id, passphrase }: { id: number; passphrase: string }) =>
    api<TransferJob>(`/api/transfer/jobs/${id}/check`, { method: 'POST', body: { passphrase } }),
  )

export const useApply = () =>
  useStart(({ id, passphrase, replace }: { id: number; passphrase: string; replace: boolean }) =>
    api<TransferJob>(`/api/transfer/jobs/${id}/apply`, { method: 'POST', body: { passphrase, replace } }),
  )

export function downloadUrl(job: TransferJob) {
  return `/api/transfer/jobs/${job.id}/download`
}

/** 1536 → "1.5 KB" (binary units, in the UI language's digits). */
export function formatBytes(bytes: number, locale: string): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: i ? 1 : 0 }).format(n)} ${units[i]}`
}
