import { SearchX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { EmptyState } from '@/shared/components/EmptyState'
import { Button } from '@/shared/ui/button'

export function ProjectNotFound() {
  const { t } = useTranslation()
  return (
    <EmptyState
      as="h1"
      icon={SearchX}
      title={t('projects.detail.notFound')}
      description={t('projects.detail.notFoundBody')}
      action={
        <Button asChild variant="outline">
          <Link to="/projects">{t('projects.detail.backToList')}</Link>
        </Button>
      }
    />
  )
}
