import { Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { NativeSelect } from '@/shared/ui/native-select'

import { PROJECT_STATUSES, PROJECT_TYPES, SORT_FIELDS, type ProjectQuery } from '../types'

interface Props {
  query: ProjectQuery
  onChange: (patch: Partial<ProjectQuery>) => void
  onClear: () => void
  filtered: boolean
}

export function ProjectFilters({ query, onChange, onClear, filtered }: Props) {
  const { t } = useTranslation()
  const [text, setText] = useState(query.q)
  const [syncedQ, setSyncedQ] = useState(query.q)
  const timer = useRef<number | undefined>(undefined)

  // Back/forward or "clear" can change the URL under us: follow it.
  if (query.q !== syncedQ) {
    setSyncedQ(query.q)
    setText(query.q)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])

  // Search is sent once typing pauses for 300 ms, never per keystroke.
  const type = (value: string) => {
    setText(value)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => onChange({ q: value }), 300)
  }

  return (
    <div role="search" className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,11rem))] md:items-end">
      <div className="grid gap-1.5">
        <Label htmlFor="project-search">{t('projects.search')}</Label>
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" aria-hidden="true" />
          <Input
            id="project-search"
            type="search"
            className="pl-9"
            placeholder={t('projects.searchPlaceholder')}
            maxLength={200}
            value={text}
            onChange={(e) => type(e.target.value)}
          />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="project-type">{t('projects.filterType')}</Label>
        <NativeSelect id="project-type" value={query.type} onChange={(e) => onChange({ type: e.target.value as ProjectQuery['type'] })}>
          <option value="">{t('projects.allTypes')}</option>
          {PROJECT_TYPES.map((v) => (
            <option key={v} value={v}>
              {t(`projects.type.${v}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="project-status">{t('projects.filterStatus')}</Label>
        <NativeSelect id="project-status" value={query.status} onChange={(e) => onChange({ status: e.target.value as ProjectQuery['status'] })}>
          <option value="">{t('projects.allStatuses')}</option>
          {PROJECT_STATUSES.map((v) => (
            <option key={v} value={v}>
              {t(`projects.status.${v}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="project-sort">{t('projects.sortBy')}</Label>
        <NativeSelect
          id="project-sort"
          value={`${query.sort}:${query.order}`}
          onChange={(e) => {
            const [sort, order] = e.target.value.split(':') as [ProjectQuery['sort'], ProjectQuery['order']]
            onChange({ sort, order })
          }}
        >
          {SORT_FIELDS.flatMap((field) =>
            (['desc', 'asc'] as const).map((order) => (
              <option key={`${field}:${order}`} value={`${field}:${order}`}>
                {t(`projects.sort.${field}`)} · {t(`projects.order.${order}`)}
              </option>
            )),
          )}
        </NativeSelect>
      </div>
      {filtered && (
        <Button type="button" variant="ghost" size="sm" className="w-fit md:col-start-1" onClick={onClear}>
          <X aria-hidden="true" />
          {t('projects.clearFilters')}
        </Button>
      )}
    </div>
  )
}
