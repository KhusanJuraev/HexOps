import { Construction } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/shared/components/EmptyState'

/**
 * Honest placeholder for modules scheduled in later stages. It stores and shows
 * no data, so nothing here should be mistaken for a working feature.
 */
export function NotBuiltYet() {
  const { t } = useTranslation()
  return <EmptyState icon={Construction} title={t('placeholder.title')} description={t('placeholder.body')} />
}
