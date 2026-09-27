import type { TFunction } from 'i18next'

import type { ActivityEvent } from './types'

function fieldList(t: TFunction, entity: string, fields: unknown): string {
  return Array.isArray(fields) ? fields.map((f) => t(`${entity}s.fields.${String(f)}`)).join(', ') : ''
}

/** Translate one event. Unknown future actions still show something readable. */
export function describe(t: TFunction, e: ActivityEvent): string {
  const d = e.details
  const statusKey = e.entity_type === 'report' ? 'reports.status' : 'projects.status'
  const status = (value: unknown) => t(`${statusKey}.${String(value)}`)
  switch (e.action) {
    case 'project.created':
    case 'report.created':
    case 'note.created':
    case 'project.deleted':
      return t(`activity.${e.action.replace('.', '_')}`)
    case 'note.deleted':
      return t('activity.note_deleted', { title: String(d.title ?? '') })
    case 'report.deleted':
      return t('activity.report_deleted', { title: String(d.title ?? '') })
    case 'project.status_changed':
    case 'report.status_changed':
      return t('activity.status_changed', { from: status(d.from), to: status(d.to) })
    case 'report.status_corrected':
      return t('activity.status_corrected', { from: status(d.from), to: status(d.to) })
    case 'project.updated':
    case 'report.updated':
    case 'note.updated':
      return t('activity.updated', { fields: fieldList(t, e.entity_type, d.fields) })
    case 'report.attachment_added':
      return t('activity.attachment_added', { name: String(d.name ?? '') })
    case 'report.attachment_deleted':
      return t('activity.attachment_deleted', { name: String(d.name ?? '') })
    default:
      return e.action
  }
}
