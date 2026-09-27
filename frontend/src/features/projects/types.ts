// Mirrors backend/app/modules/projects/schemas.py.

export const PROJECT_TYPES = ['bounty_program', 'pentest_client', 'personal_research'] as const
export const PROJECT_STATUSES = ['active', 'paused', 'closed'] as const
export const SCOPE_KINDS = ['domain', 'wildcard', 'url', 'ip', 'cidr', 'other'] as const
export const SORT_FIELDS = ['updated_at', 'created_at', 'name', 'start_date', 'status'] as const
export const MAX_SCOPE_ITEMS = 500

export type ProjectType = (typeof PROJECT_TYPES)[number]
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]
export type ScopeKind = (typeof SCOPE_KINDS)[number]
export type SortField = (typeof SORT_FIELDS)[number]

export interface ScopeItem {
  kind: ScopeKind
  value: string
  note: string
}

export interface ProjectInput {
  name: string
  type: ProjectType
  status: ProjectStatus
  start_date: string | null
  description: string
  scope: ScopeItem[]
}

export interface Project extends ProjectInput {
  id: number
  created_at: string
  updated_at: string
}

export interface ProjectListItem {
  id: number
  name: string
  type: ProjectType
  status: ProjectStatus
  start_date: string | null
  scope_count: number
  created_at: string
  updated_at: string
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  size: number
}

export interface ProjectQuery {
  q: string
  type: ProjectType | ''
  status: ProjectStatus | ''
  sort: SortField
  order: 'asc' | 'desc'
  page: number
}
