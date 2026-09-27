import { AlertDialog as Primitive } from 'radix-ui'
import * as React from 'react'

import { cn } from '@/shared/lib/utils'

// Minimal accessible confirmation dialog (Radix AlertDialog): focus trap, Escape,
// focus returns to the trigger, and the Cancel button gets initial focus.
const AlertDialog = Primitive.Root
const AlertDialogTrigger = Primitive.Trigger
const AlertDialogCancel = Primitive.Cancel
const AlertDialogAction = Primitive.Action

function AlertDialogContent({ className, children, ...props }: React.ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <Primitive.Content
        className={cn(
          'bg-popover text-popover-foreground fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border p-6 shadow-lg',
          className,
        )}
        {...props}
      >
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  )
}

function AlertDialogTitle({ className, ...props }: React.ComponentProps<typeof Primitive.Title>) {
  return <Primitive.Title className={cn('text-lg font-semibold', className)} {...props} />
}

function AlertDialogDescription({ className, ...props }: React.ComponentProps<typeof Primitive.Description>) {
  return <Primitive.Description className={cn('text-muted-foreground text-sm', className)} {...props} />
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
}
