import { useTranslation } from 'react-i18next'

import { Badge, type BadgeTone } from '@/shared/components/Badge'

import type { ProjectStatus, ProjectType } from '../types'

const STATUS_TONE: Record<ProjectStatus, BadgeTone> = { active: 'success', paused: 'warning', closed: 'neutral' }

export function StatusBadge({ status }: { status: ProjectStatus }) {
  const { t } = useTranslation()
  return (
    <Badge tone={STATUS_TONE[status]} dot>
      {t(`projects.status.${status}`)}
    </Badge>
  )
}

export function TypeBadge({ type }: { type: ProjectType }) {
  const { t } = useTranslation()
  return <Badge tone="accent">{t(`projects.type.${type}`)}</Badge>
}
