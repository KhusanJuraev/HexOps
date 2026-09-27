import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { useToast } from '@/shared/components/toast'

import { useConnection } from './api'

/**
 * Mounted once at the app root. Keeps the health probe running on every screen
 * and, when the backend comes back, refetches whatever failed while it was down.
 */
export function ConnectionWatcher() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const { state } = useConnection()
  const previous = useRef(state)

  useEffect(() => {
    const was = previous.current
    previous.current = state
    if (state === 'online' && (was === 'offline' || was === 'database')) {
      void qc.invalidateQueries({ predicate: (q) => q.state.status === 'error' })
      toast({ message: t('connection.restored'), tone: 'success' })
    }
  }, [state, qc, toast, t])

  return null
}
