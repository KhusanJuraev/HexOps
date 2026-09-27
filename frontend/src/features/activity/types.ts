// Mirrors backend/app/modules/activity/schemas.py.
export interface ActivityEvent {
  id: number
  occurred_at: string
  entity_type: 'project' | 'report' | 'note' | string
  entity_id: number
  project_id: number | null
  actor: string | null
  action: string
  details: Record<string, unknown>
}

export interface ActivityPage {
  items: ActivityEvent[]
  total: number
  page: number
  size: number
}

/** One project's history (all its records), or one record's own history. */
export type ActivityScope =
  | { all: true } // everything, newest first (Dashboard)
  | { projectId: number }
  | { entityType: 'project' | 'report' | 'note'; entityId: number }
