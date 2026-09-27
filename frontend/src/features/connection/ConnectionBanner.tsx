import { DatabaseZap, WifiOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/lib/utils'

import { useConnection } from './api'

/** Explains an outage in place, so it is never mistaken for a sign-in problem. */
export function ConnectionBanner({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { state, recheck, isRechecking } = useConnection()
  if (state !== 'offline' && state !== 'database') return null

  const database = state === 'database'
  const Icon = database ? DatabaseZap : WifiOff
  return (
    <div
      role="alert"
      className={cn(
        'bg-card flex flex-wrap items-start gap-3 rounded-xl border px-4 py-3 text-sm',
        database ? 'border-warning/50' : 'border-danger/50',
        className,
      )}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', database ? 'text-warning' : 'text-danger')} aria-hidden="true" />
      <div className="min-w-0 flex-1 basis-48">
        <p className="font-medium">{t(database ? 'connection.databaseTitle' : 'connection.offlineTitle')}</p>
        <p className="text-muted-foreground mt-0.5">{t(database ? 'connection.databaseBody' : 'connection.offlineBody')}</p>
      </div>
      <Button variant="outline" size="sm" onClick={recheck} disabled={isRechecking}>
        {t('common.retry')}
      </Button>
    </div>
  )
}
