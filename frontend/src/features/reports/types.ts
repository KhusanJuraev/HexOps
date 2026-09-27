// Mirrors backend/app/modules/reports/schemas.py.

export const REPORT_TYPES = ['cve', 'bbp', 'vdp', 'pentest'] as const
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const
export const REPORT_STATUSES = ['draft', 'submitted', 'triaged', 'accepted', 'duplicate', 'rejected', 'paid'] as const
export const REPORT_SORTS = ['updated_at', 'created_at', 'submitted_at', 'severity', 'status', 'title'] as const
export const DATE_FIELDS = ['submitted_at', 'triaged_at', 'closed_at', 'paid_at'] as const
export const MAX_BODY_CHARS = 200_000

export type ReportType = (typeof REPORT_TYPES)[number]
export type Severity = (typeof SEVERITIES)[number]
export type ReportStatus = (typeof REPORT_STATUSES)[number]
export type ReportSort = (typeof REPORT_SORTS)[number]

export interface ReportInput {
  project_id: number
  title: string
  type: ReportType
  severity: Severity
  cvss_score: string | null // decimals travel as strings, never as floats
  cvss_vector: string | null
  body_md: string
  bounty_amount: string | null
  bounty_currency: string | null
}

export interface Report extends ReportInput {
  id: number
  project_name: string
  status: ReportStatus
  submitted_at: string | null
  triaged_at: string | null
  closed_at: string | null
  paid_at: string | null
  created_at: string
  updated_at: string
  next_statuses: ReportStatus[]
  correction_to: ReportStatus | null
}

export interface ReportListItem {
  id: number
  project_id: number
  project_name: string
  title: string
  type: ReportType
  severity: Severity
  cvss_score: string | null
  status: ReportStatus
  submitted_at: string | null
  bounty_amount: string | null
  bounty_currency: string | null
  created_at: string
  updated_at: string
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  size: number
}

export interface ReportQuery {
  q: string
  project_id: number | null
  type: ReportType | ''
  severity: Severity | ''
  status: ReportStatus | ''
  /** Created between these UTC days (YYYY-MM-DD), both included; '' = open. */
  created_from: string
  created_to: string
  sort: ReportSort
  order: 'asc' | 'desc'
  page: number
}

export interface Attachment {
  id: number
  report_id: number
  original_name: string
  content_type: string
  size_bytes: number
  sha256: string
  created_at: string
}

export interface ProjectOption {
  id: number
  name: string
}
