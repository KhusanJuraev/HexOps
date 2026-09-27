import { SearchX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { EmptyState } from '@/shared/components/EmptyState'
import { Button } from '@/shared/ui/button'

export function NoteNotFound() {
  const { t } = useTranslation()
  return (
    <EmptyState
      as="h1"
      icon={SearchX}
      title={t('notes.detail.notFound')}
      description={t('notes.detail.notFoundBody')}
      action={
        <Button asChild variant="outline">
          <Link to="/notes">{t('notes.detail.backToList')}</Link>
        </Button>
      }
    />
  )
}
