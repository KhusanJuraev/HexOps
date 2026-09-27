import type { ReactNode } from 'react'

import { ErrorBoundary } from './ErrorBoundary'

/** A titled card on a detail page. Each section fails on its own (ErrorBoundary). */
export function Section({ id, title, action, children }: { id: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="bg-card grid min-w-0 grid-cols-1 gap-4 rounded-xl border p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        {action}
      </div>
      <ErrorBoundary>{children}</ErrorBoundary>
    </section>
  )
}
