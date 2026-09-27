import type { ComponentProps } from 'react'

import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'

interface FormFieldProps extends ComponentProps<typeof Input> {
  id: string
  label: string
  /** Translated error; also marks the input invalid and links it for screen readers. */
  error?: string | null
  /** Translated helper text shown under the input while there is no error. */
  hint?: string
}

/** Label + input + hint/error, wired with aria-invalid and aria-describedby. */
export function FormField({ id, label, error, hint, ...props }: FormFieldProps) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...props} />
      {error ? (
        <p id={`${id}-error`} className="text-danger text-sm">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-muted-foreground text-xs">
            {hint}
          </p>
        )
      )}
    </div>
  )
}
