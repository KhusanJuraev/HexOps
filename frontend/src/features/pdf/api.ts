import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/shared/api/client'

export type JobStatus = 'queued' | 'running' | 'done' | 'failed'
export type SourceType = 'report' | 'note'
export type ExportLang = 'en' | 'ru' | 'uz'

export interface PdfDraft {
  title: string
  markdown: string
}

export interface PdfJob {
  id: number
  kind: 'export' | 'import'
  status: JobStatus
  progress: number
  source_type: SourceType | null
  source_id: number | null
  original_name: string | null
  result_filename: string | null
  page_count: number | null
  warnings: string[]
  error_code: string | null
  created_at: string
  finished_at: string | null
  expires_at: string
  draft: PdfDraft | null
}

export interface ImportLimits {
  max_bytes: number
  max_pages: number
}

/** The server's configured import limits (HEXOPS_PDF_IMPORT_MAX_*), shown up front. */
export function useImportLimits() {
  return useQuery({
    queryKey: ['pdf', 'limits'],
    queryFn: ({ signal }) => api<ImportLimits>('/api/pdf/limits', { signal }),
    staleTime: Infinity,
  })
}

/** The server holds each status request up to this long, until the job changes. */
export const LONG_POLL_SECONDS = 20

export const pdfKeys = {
  job: (id: number) => ['pdf', 'job', id] as const,
}

export function isFinished(job: PdfJob | undefined): boolean {
  return job?.status === 'done' || job?.status === 'failed'
}

export function downloadUrl(job: PdfJob): string {
  return `/api/pdf/jobs/${job.id}/download`
}

/**
 * Follows a job until it finishes. Each request is a long poll: the server answers
 * as soon as the job changes (or after LONG_POLL_SECONDS), so a job of any length
 * costs a handful of requests, never a rapid polling loop (D-83).
 */
export function useJob(id: number | null) {
  return useQuery({
    queryKey: pdfKeys.job(id ?? 0),
    enabled: id !== null,
    queryFn: ({ signal }) => api<PdfJob>(`/api/pdf/jobs/${id}?wait=${LONG_POLL_SECONDS}`, { signal }),
    // The next long poll starts right after the previous one returns.
    refetchInterval: (q) => (q.state.data && !isFinished(q.state.data) ? 50 : false),
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  })
}

function useStartJob<T>(request: (input: T) => Promise<PdfJob>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: request,
    onSuccess: (job) => qc.setQueryData(pdfKeys.job(job.id), job),
  })
}

export function useCreateExport() {
  return useStartJob((input: { source_type: SourceType; source_id: number; lang: ExportLang }) =>
    api<PdfJob>('/api/pdf/exports', { method: 'POST', body: input }),
  )
}

export function useCreateImport() {
  return useStartJob((file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api<PdfJob>('/api/pdf/imports', { method: 'POST', body: form })
  })
}

/** Deletes the job and its files on the server (best effort; they expire anyway). */
export function discardJob(id: number): void {
  void api(`/api/pdf/jobs/${id}`, { method: 'DELETE' }).catch(() => undefined)
}

export function exportLang(language: string): ExportLang {
  const base = language.slice(0, 2)
  return base === 'ru' || base === 'uz' ? base : 'en'
}
