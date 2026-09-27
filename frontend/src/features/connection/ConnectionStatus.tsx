import { useTranslation } from 'react-i18next'

import { Badge, type BadgeTone } from '@/shared/components/Badge'

import { useConnection, type ConnectionState } from './api'

const TONE: Record<ConnectionState, BadgeTone> = {
  checking: 'neutral',
  online: 'success',
  database: 'warning',
  offline: 'danger',
}

/**
 * Compact header indicator. Not a live region: outages are announced by
 * ConnectionBanner and recovery by a toast, so screen readers hear each once.
 */
export function ConnectionStatus() {
  const { t } = useTranslation()
  const { state } = useConnection()
  return (
    <Badge tone={TONE[state]} dot className="px-2 sm:px-2.5" data-connection={state}>
      <span className="sr-only">{t('connection.status')}: </span>
      <span className="sr-only sm:not-sr-only">{t(`connection.${state}`)}</span>
    </Badge>
  )
}
