import { cn } from '@/shared/lib/utils'

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-7 shrink-0', className)}>
      <rect width="32" height="32" rx="8" className="fill-foreground" />
      <path
        d="M16 6.5 24.2 11.25v9.5L16 25.5 7.8 20.75v-9.5z"
        fill="none"
        className="stroke-background"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}
