import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/shared/lib/utils'

import { ToastContext, type ToastInput, type ToastTone } from './toast'

interface Toast extends Required<ToastInput> {
  id: number
}

const MAX_VISIBLE = 3
const DURATION_MS: Record<ToastTone, number> = { info: 5000, success: 5000, error: 8000 }
const ICONS = { info: Info, success: CheckCircle2, error: CircleAlert }
const ICON_COLOURS: Record<ToastTone, string> = {
  info: 'text-muted-foreground',
  success: 'text-success',
  error: 'text-danger',
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const { t } = useTranslation()
  const [paused, setPaused] = useState(false)
  const Icon = ICONS[toast.tone]

  // Auto-dismiss, but never while the pointer or keyboard focus is on the toast.
  useEffect(() => {
    if (paused) return
    const timer = window.setTimeout(() => onDismiss(toast.id), DURATION_MS[toast.tone])
    return () => window.clearTimeout(timer)
  }, [paused, toast.id, toast.tone, onDismiss])

  return (
    <li
      className="bg-popover text-popover-foreground pointer-events-auto flex w-full items-start gap-3 rounded-xl border p-3 pl-4 text-sm shadow-lg sm:w-96"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', ICON_COLOURS[toast.tone])} aria-hidden="true" />
      <p className="min-w-0 flex-1 break-words">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label={t('toast.close')}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -m-1 rounded-md p-1 outline-none focus-visible:ring-[3px]"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </li>
  )
}

/**
 * Lightweight toasts. The two live regions are always mounted so screen readers
 * announce new messages: errors assertively, everything else politely.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((x) => x.id !== id)), [])
  const show = useCallback(({ message, tone = 'info' }: ToastInput) => {
    const id = nextId.current++
    setToasts((all) => [...all, { id, message, tone }].slice(-MAX_VISIBLE))
  }, [])

  const region = (items: Toast[], role: 'status' | 'alert') => (
    <ol role={role} className="flex w-full flex-col items-center gap-2 sm:items-end">
      {items.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
      ))}
    </ol>
  )

  return (
    <ToastContext value={show}>
      {children}
      <section
        aria-label={t('toast.region')}
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end"
      >
        {region(toasts.filter((x) => x.tone !== 'error'), 'status')}
        {region(toasts.filter((x) => x.tone === 'error'), 'alert')}
      </section>
    </ToastContext>
  )
}
