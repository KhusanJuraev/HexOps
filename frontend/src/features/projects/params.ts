import { DEFAULT_QUERY } from './api'
import { PROJECT_STATUSES, PROJECT_TYPES, SORT_FIELDS, type ProjectQuery } from './types'

const oneOf = <T extends string>(values: readonly T[], value: string | null, fallback: T | ''): T | '' =>
  value !== null && (values as readonly string[]).includes(value) ? (value as T) : fallback

/** Read list filters from the URL, ignoring anything unexpected. */
export function parseQuery(params: URLSearchParams): ProjectQuery {
  const page = Number(params.get('page'))
  return {
    q: (params.get('q') ?? '').slice(0, 200),
    type: oneOf(PROJECT_TYPES, params.get('type'), ''),
    status: oneOf(PROJECT_STATUSES, params.get('status'), ''),
    sort: (oneOf(SORT_FIELDS, params.get('sort'), DEFAULT_QUERY.sort) || DEFAULT_QUERY.sort) as ProjectQuery['sort'],
    order: params.get('order') === 'asc' ? 'asc' : 'desc',
    page: Number.isInteger(page) && page > 0 ? page : 1,
  }
}

/** '/projects/42' → 42; anything else → null (shown as "not found"). */
export function parseProjectId(value: string | undefined): number | null {
  const id = Number(value)
  return /^\d+$/.test(value ?? '') && id > 0 && id <= 2_147_483_647 ? id : null
}
