// Mirrors backend/app/modules/notes/schemas.py.
export const MAX_BODY_CHARS = 200_000
export const MAX_TAGS = 20
export const NOTE_SORTS = ['updated_at', 'created_at', 'title'] as const
export type NoteSort = (typeof NOTE_SORTS)[number]

export interface NoteInput {
  title: string
  body_md: string
  project_id: number | null
  tags: string[]
}

export interface Note extends NoteInput {
  id: number
  project_name: string | null
  created_at: string
  updated_at: string
}

export interface NoteListItem {
  id: number
  title: string
  project_id: number | null
  project_name: string | null
  tags: string[]
  created_at: string
  updated_at: string
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  size: number
}

export interface NoteQuery {
  q: string
  tag: string[]
  project_id: number | null
  sort: NoteSort
  order: 'asc' | 'desc'
  page: number
}

export interface TagCount {
  name: string
  count: number
}
