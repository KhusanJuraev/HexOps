import { AlertTriangle } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouteError } from 'react-router'

import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/lib/utils'

/**
 * Route-level error boundary. Attached to every page route, so a page that fails
 * to load or render is replaced in place while the shell and navigation keep
 * working; moving to another page clears it.
 */
export function RouteError({ fullPage = false }: { fullPage?: boolean }) {
  const { t } = useTranslation()
  const error = useRouteError()
  // Developer console only (once per error); the UI shows a generic, translated message.
  useEffect(() => console.error('HexOps page failed', error), [error])

  return (
    <div
      role="alert"
      className={cn(
        'bg-card flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center',
        fullPage && 'mx-4 my-10 sm:mx-auto sm:max-w-lg',
      )}
    >
      <AlertTriangle className="text-warning size-6" aria-hidden="true" />
      <h1 className="text-base font-medium">{t('errors.pageFailed')}</h1>
      <p className="text-muted-foreground max-w-md text-sm">{t('errors.pageFailedBody')}</p>
      <Button variant="outline" onClick={() => window.location.reload()}>
        {t('common.reload')}
      </Button>
    </div>
  )
}
