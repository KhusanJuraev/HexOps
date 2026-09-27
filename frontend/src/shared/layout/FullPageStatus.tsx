import { DatabaseZap, Loader2, WifiOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/shared/ui/button'

interface Props {
  kind: 'loading' | 'error' | 'offline' | 'database'
  onRetry?: () => void
}

export function FullPageStatus({ kind, onRetry }: Props) {
  const { t } = useTranslation()

  if (kind === 'loading') {
    return (
      <div role="status" className="text-muted-foreground flex min-h-[50dvh] flex-col items-center justify-center gap-3 text-sm">
        <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        <span>{t('common.loading')}</span>
      </div>
    )
  }

  // Outages get their own wording so they are never read as "please sign in".
  const outage = kind === 'offline' || kind === 'database'
  const Icon = kind === 'database' ? DatabaseZap : WifiOff
  return (
    <div role="alert" className="flex min-h-[50dvh] flex-col items-center justify-center gap-3 px-4 text-center text-sm">
      {outage && <Icon className="text-muted-foreground size-6" aria-hidden="true" />}
      <p className="text-base font-medium">
        {outage ? t(kind === 'database' ? 'connection.databaseTitle' : 'connection.offlineTitle') : t('common.error')}
      </p>
      {outage && (
        <p className="text-muted-foreground max-w-md">
          {t(kind === 'database' ? 'connection.databaseBody' : 'connection.offlineBody')}
        </p>
      )}
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  )
}
