import { useTranslation } from 'react-i18next'

import { Badge, type BadgeTone } from '@/shared/components/Badge'

import type { ReportStatus, ReportType, Severity } from '../types'

const SEVERITY_TONE: Record<Severity, BadgeTone> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'accent',
  info: 'neutral',
}
const STATUS_TONE: Record<ReportStatus, BadgeTone> = {
  draft: 'neutral',
  submitted: 'accent',
  triaged: 'accent',
  accepted: 'success',
  duplicate: 'neutral',
  rejected: 'neutral',
  paid: 'success',
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const { t } = useTranslation()
  return (
    <Badge tone={SEVERITY_TONE[severity]} dot>
      {t(`reports.severity.${severity}`)}
    </Badge>
  )
}

export function ReportStatusBadge({ status }: { status: ReportStatus }) {
  const { t } = useTranslation()
  return <Badge tone={STATUS_TONE[status]}>{t(`reports.status.${status}`)}</Badge>
}

export function ReportTypeBadge({ type }: { type: ReportType }) {
  const { t } = useTranslation()
  return <Badge>{t(`reports.type.${type}`)}</Badge>
}
