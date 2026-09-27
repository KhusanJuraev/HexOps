import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/shared/ui/button'

interface Props {
  page: number
  size: number
  total: number
  onPage: (page: number) => void
}

/** Previous / next with "21–40 of 57". Works the same on phones and desktops. */
export function Pagination({ page, size, total, onPage }: Props) {
  const { t } = useTranslation()
  const pages = Math.max(1, Math.ceil(total / size))
  if (total <= size && page === 1) return null
  const from = total === 0 ? 0 : (page - 1) * size + 1
  const to = Math.min(total, page * size)
  return (
    <nav aria-label={t('pagination.label')} className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-muted-foreground" aria-live="polite">
        {t('pagination.range', { from, to, total })}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft aria-hidden="true" />
          {t('pagination.previous')}
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          {t('pagination.next')}
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  )
}
