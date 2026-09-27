import { DEFAULT_QUERY } from './api'
import { normalizeTag } from './tags'
import { NOTE_SORTS, type NoteQuery } from './types'

export function parseId(value: string | null | undefined): number | null {
  const n = Number(value)
  return /^\d+$/.test(value ?? '') && n > 0 && n <= 2_147_483_647 ? n : null
}

/** Read list filters from the URL, ignoring anything unexpected. */
export function parseQuery(params: URLSearchParams): NoteQuery {
  const page = Number(params.get('page'))
  const sort = params.get('sort')
  const tags = params.getAll('tag').map(normalizeTag).filter((t): t is string => t !== null)
  return {
    q: (params.get('q') ?? '').slice(0, 200),
    tag: [...new Set(tags)].slice(0, 20),
    project_id: parseId(params.get('project_id')),
    sort: sort && (NOTE_SORTS as readonly string[]).includes(sort) ? (sort as NoteQuery['sort']) : DEFAULT_QUERY.sort,
    order: params.get('order') === 'asc' ? 'asc' : 'desc',
    page: Number.isInteger(page) && page > 0 ? page : 1,
  }
}
