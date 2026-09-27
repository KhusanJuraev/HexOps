import { SearchX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { EmptyState } from '@/shared/components/EmptyState'
import { Button } from '@/shared/ui/button'

export default function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <EmptyState
      as="h1"
      icon={SearchX}
      title={t('notFound.title')}
      description={t('empty.notFoundBody')}
      action={
        <Button asChild variant="outline">
          <Link to="/">{t('notFound.back')}</Link>
        </Button>
      }
    />
  )
}
