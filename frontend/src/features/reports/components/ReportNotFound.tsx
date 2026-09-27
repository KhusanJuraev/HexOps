import { SearchX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { EmptyState } from '@/shared/components/EmptyState'
import { Button } from '@/shared/ui/button'

export function ReportNotFound() {
  const { t } = useTranslation()
  return (
    <EmptyState
      as="h1"
      icon={SearchX}
      title={t('reports.detail.notFound')}
      description={t('reports.detail.notFoundBody')}
      action={
        <Button asChild variant="outline">
          <Link to="/reports">{t('reports.detail.backToList')}</Link>
        </Button>
      }
    />
  )
}
