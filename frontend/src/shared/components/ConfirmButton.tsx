import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/shared/ui/alert-dialog'
import { Button } from '@/shared/ui/button'

interface Props {
  /** The trigger button's content (and its aria-label if it is icon-only). */
  children: ReactNode
  label?: string
  variant?: 'outline' | 'ghost' | 'destructive' | 'default'
  size?: 'default' | 'sm' | 'icon'
  className?: string
  title: string
  body: string
  confirmLabel: string
  pending?: boolean
  /** The trigger cannot be used yet (e.g. a required checkbox is not ticked). */
  disabled?: boolean
  onConfirm: () => void
}

/** A button that asks first (Radix AlertDialog: focus trap, Escape, focus returns). */
export function ConfirmButton({ children, label, variant = 'outline', size = 'default', className, title, body, confirmLabel, pending, disabled, onConfirm }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant={variant} size={size} className={className} aria-label={label} disabled={disabled}>
          {children}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription className="break-words">{body}</AlertDialogDescription>
        <div className="flex flex-wrap justify-end gap-2">
          <AlertDialogCancel asChild>
            <Button variant="outline">{t('common.cancel')}</Button>
          </AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => {
              onConfirm()
              setOpen(false)
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
