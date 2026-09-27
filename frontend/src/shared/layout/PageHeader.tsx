import type { ReactNode } from 'react'

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight break-words md:text-3xl">{title}</h1>
        {description && <p className="text-muted-foreground mt-1.5 text-sm break-words md:text-base">{description}</p>}
      </div>
      {actions}
    </div>
  )
}
