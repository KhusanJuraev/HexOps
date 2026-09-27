import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useBlocker } from 'react-router'

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { Button } from '@/shared/ui/button'

/**
 * Warns before leaving a form with unsaved edits: an in-app dialog for route
 * changes, the browser's own prompt for reload / close / typed URL.
 *
 *   const guard = useUnsavedChanges(dirty)
 *   onSuccess: () => { guard.release(); navigate(...) }
 *   return <>{form}{guard.dialog}</>
 */
export function useUnsavedChanges(dirty: boolean): { release: () => void; dialog: ReactNode } {
  const { t } = useTranslation()
  const released = useRef(false)
  const dirtyRef = useRef(dirty)
  useEffect(() => {
    dirtyRef.current = dirty
    if (dirty) released.current = false
  }, [dirty])

  // Read at navigation time: a save that just succeeded releases the guard first.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirtyRef.current && !released.current && currentLocation.pathname !== nextLocation.pathname,
  )

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      if (released.current) return
      e.preventDefault()
      e.returnValue = '' // required by some browsers to show the prompt
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const dialog = (
    <AlertDialog open={blocker.state === 'blocked'} onOpenChange={(open) => !open && blocker.reset?.()}>
      <AlertDialogContent>
        <AlertDialogTitle>{t('unsaved.title')}</AlertDialogTitle>
        <AlertDialogDescription>{t('unsaved.body')}</AlertDialogDescription>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => blocker.reset?.()}>
            {t('unsaved.stay')}
          </Button>
          <Button variant="destructive" onClick={() => blocker.proceed?.()}>
            {t('unsaved.leave')}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
  return { release: () => (released.current = true), dialog }
}
