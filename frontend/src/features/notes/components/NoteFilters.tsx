import { Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { NativeSelect } from '@/shared/ui/native-select'

import { useProjectOptions, useTags } from '../api'
import { NOTE_SORTS, type NoteQuery } from '../types'

interface Props {
  query: NoteQuery
  onChange: (patch: Partial<NoteQuery>) => void
  onClear: () => void
  filtered: boolean
}

export function NoteFilters({ query, onChange, onClear, filtered }: Props) {
  const { t } = useTranslation()
  const [text, setText] = useState(query.q)
  const [syncedQ, setSyncedQ] = useState(query.q)
  const timer = useRef<number | undefined>(undefined)
  const { data: tags } = useTags()
  const { data: projects } = useProjectOptions('')

  if (query.q !== syncedQ) {
    setSyncedQ(query.q)
    setText(query.q)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const type = (value: string) => {
    setText(value)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => onChange({ q: value }), 300) // debounced
  }

  return (
    <div className="grid grid-cols-1 gap-3">
      <div role="search" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
        <div className="grid gap-1.5 sm:col-span-2 lg:col-span-1">
          <Label htmlFor="note-search">{t('notes.search')}</Label>
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" aria-hidden="true" />
            <Input id="note-search" type="search" className="pl-9" placeholder={t('notes.searchPlaceholder')} maxLength={200} value={text} onChange={(e) => type(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="note-tag">{t('notes.filterTag')}</Label>
          <NativeSelect
            id="note-tag"
            value=""
            onChange={(e) => e.target.value && onChange({ tag: [...query.tag, e.target.value] })}
          >
            <option value="">{t('notes.addTagFilter')}</option>
            {tags?.filter((tag) => !query.tag.includes(tag.name)).map((tag) => (
              <option key={tag.name} value={tag.name}>
                {tag.name} ({tag.count})
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="note-project">{t('notes.filterProject')}</Label>
          <NativeSelect
            id="note-project"
            value={query.project_id ?? ''}
            onChange={(e) => onChange({ project_id: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">{t('notes.allProjects')}</option>
            {projects?.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="note-sort">{t('notes.sortBy')}</Label>
          <NativeSelect
            id="note-sort"
            value={`${query.sort}:${query.order}`}
            onChange={(e) => {
              const [sort, order] = e.target.value.split(':') as [NoteQuery['sort'], NoteQuery['order']]
              onChange({ sort, order })
            }}
          >
            {NOTE_SORTS.flatMap((field) =>
              (['desc', 'asc'] as const).map((order) => (
                <option key={`${field}:${order}`} value={`${field}:${order}`}>
                  {t(`notes.sort.${field}`)} · {t(`notes.order.${order}`)}
                </option>
              )),
            )}
          </NativeSelect>
        </div>
      </div>
      {(query.tag.length > 0 || filtered) && (
        <div className="flex flex-wrap items-center gap-2">
          {query.tag.map((tag) => (
            <Button key={tag} variant="outline" size="sm" className="h-7 max-w-full rounded-full" aria-label={t('notes.removeTagFilter', { tag })} onClick={() => onChange({ tag: query.tag.filter((x) => x !== tag) })}>
              <span className="truncate">#{tag}</span>
              <X aria-hidden="true" />
            </Button>
          ))}
          {filtered && (
            <Button variant="ghost" size="sm" onClick={onClear}>
              {t('notes.clearFilters')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
