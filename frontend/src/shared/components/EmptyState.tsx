import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/shared/lib/utils'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  /** Optional call to action, e.g. a "Create" button. */
  action?: ReactNode
  /** Heading level; defaults to h2 because pages normally own the h1. */
  as?: 'h1' | 'h2' | 'h3'
  className?: string
}

/** Honest "nothing here yet" panel for lists, searches and unbuilt sections. */
export function EmptyState({ icon: Icon, title, description, action, as: Heading = 'h2', className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'bg-card flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center',
        className,
      )}
    >
      {Icon && <Icon className="text-muted-foreground size-6" aria-hidden="true" />}
      <Heading className="text-base font-medium">{title}</Heading>
      {description && <p className="text-muted-foreground max-w-md text-sm">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
