import { DEFAULT_QUERY } from './api'
import { REPORT_SORTS, REPORT_STATUSES, REPORT_TYPES, SEVERITIES, type ReportQuery } from './types'

const oneOf = <T extends string>(values: readonly T[], value: string | null): T | '' =>
  value !== null && (values as readonly string[]).includes(value) ? (value as T) : ''

export function parseId(value: string | null | undefined): number | null {
  const n = Number(value)
  return /^\d+$/.test(value ?? '') && n > 0 && n <= 2_147_483_647 ? n : null
}

/** A real calendar day as YYYY-MM-DD, or ''. */
function isoDay(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return ''
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value) ? value : ''
}

/** Read list filters from the URL, ignoring anything unexpected. */
export function parseQuery(params: URLSearchParams): ReportQuery {
  const page = Number(params.get('page'))
  const from = isoDay(params.get('created_from'))
  const to = isoDay(params.get('created_to'))
  return {
    q: (params.get('q') ?? '').slice(0, 200),
    project_id: parseId(params.get('project_id')),
    type: oneOf(REPORT_TYPES, params.get('type')),
    severity: oneOf(SEVERITIES, params.get('severity')),
    status: oneOf(REPORT_STATUSES, params.get('status')),
    created_from: from,
    created_to: from && to && to < from ? '' : to, // a reversed range keeps only the start
    sort: (oneOf(REPORT_SORTS, params.get('sort')) || DEFAULT_QUERY.sort) as ReportQuery['sort'],
    order: params.get('order') === 'asc' ? 'asc' : 'desc',
    page: Number.isInteger(page) && page > 0 ? page : 1,
  }
}
