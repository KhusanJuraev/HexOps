import { AlertTriangle } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/shared/ui/button'

/** Default fallback: a small in-place notice with a retry button. */
export function SectionError({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation()
  return (
    <div role="alert" className="bg-card flex flex-wrap items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-sm">
      <AlertTriangle className="text-warning size-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">{t('errors.sectionFailed')}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  )
}

interface Props {
  children: ReactNode
  /** Custom fallback; receives a reset function that re-renders the children. */
  fallback?: (reset: () => void) => ReactNode
}

/**
 * Contains a render error to one part of a page, e.g. a single Dashboard widget,
 * so the rest of the page keeps working. Data-loading errors are not thrown here:
 * each widget shows its own query's error state.
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Developer console only; never shown to the user or sent anywhere.
    console.error('HexOps section failed to render', error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) return this.props.fallback?.(this.reset) ?? <SectionError onRetry={this.reset} />
    return this.props.children
  }
}
