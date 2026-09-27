import { FileText, NotebookPen, Search, SearchX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'

import { apiErrorMessage } from '@/shared/api/errors'
import { Badge } from '@/shared/components/Badge'
import { EmptyState } from '@/shared/components/EmptyState'
import { Highlight } from '@/shared/components/Highlight'
import { Pagination } from '@/shared/components/Pagination'
import { PageHeader } from '@/shared/layout/PageHeader'
import { formatDateTime } from '@/shared/lib/format'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { NativeSelect } from '@/shared/ui/native-select'

import { PAGE_SIZE, useNoteTags, useSearch, type SearchKind, type SearchParams } from './api'

const KINDS: SearchKind[] = ['all', 'report', 'note']

function readParams(params: URLSearchParams): SearchParams {
  const kind = params.get('kind')
  const page = Number(params.get('page'))
  return {
    q: (params.get('q') ?? '').slice(0, 200),
    kind: kind === 'report' || kind === 'note' ? kind : 'all',
    tag: params.getAll('tag').slice(0, 8),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  }
}

function writeParams(p: SearchParams): URLSearchParams {
  const out = new URLSearchParams()
  if (p.q) out.set('q', p.q)
  if (p.kind !== 'all') out.set('kind', p.kind)
  for (const t of p.tag) out.append('tag', t)
  if (p.page > 1) out.set('page', String(p.page))
  return out
}

export default function SearchPage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const current = readParams(params)
  const { data, isPending, isFetching, isError, error, refetch, isPlaceholderData } = useSearch(current)
  const { data: tags } = useNoteTags()
  const [text, setText] = useState(current.q)
  const [syncedQ, setSyncedQ] = useState(current.q)
  const timer = useRef<number | undefined>(undefined)

  if (current.q !== syncedQ) {
    setSyncedQ(current.q)
    setText(current.q)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const update = (patch: Partial<SearchParams>, replace = false) =>
    setParams((prev) => writeParams({ ...readParams(prev), page: 1, ...patch }), { replace })
  // One request after typing pauses for 300 ms; never one per keystroke.
  const type = (value: string) => {
    setText(value)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => update({ q: value.trim() }, true), 300)
  }

  let results: React.ReactNode = null
  if (!current.q)
    results = <EmptyState icon={Search} title={t('search.startTitle')} description={t('search.startBody')} />
  else if (isPending) results = <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
  else if (isError)
    results = (
      <div role="alert" className="bg-card flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm">
        <p className="flex-1">{apiErrorMessage(t, error)}</p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    )
  else if (data.total === 0)
    results = <EmptyState icon={SearchX} title={t('search.noResults')} description={t('search.noResultsBody')} />
  else
    results = (
      <div className={isPlaceholderData ? 'grid grid-cols-1 gap-4 opacity-60' : 'grid grid-cols-1 gap-4'} aria-busy={isFetching}>
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {t('search.count', { count: data.total })}
        </p>
        <ol className="grid grid-cols-1 gap-3">
          {data.items.map((hit) => {
            const Icon = hit.kind === 'report' ? FileText : NotebookPen
            return (
              <li key={`${hit.kind}-${hit.id}`} className="bg-card grid min-w-0 grid-cols-1 gap-1.5 rounded-xl border p-4">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                  <span className="sr-only">{t(`search.kinds.${hit.kind}`)}:</span>
                  <Link to={`/${hit.kind}s/${hit.id}`} className="min-w-0 font-medium break-words hover:underline focus-visible:underline">
                    <Highlight text={hit.title} terms={data.terms} />
                  </Link>
                  {hit.severity && <Badge>{t(`reports.severity.${hit.severity}`)}</Badge>}
                  {hit.status && <Badge tone="accent">{t(`reports.status.${hit.status}`)}</Badge>}
                </div>
                {hit.snippet && (
                  <p className="text-muted-foreground text-sm break-words">
                    <Highlight text={hit.snippet} terms={data.terms} />
                  </p>
                )}
                <p className="text-muted-foreground text-xs break-words">
                  {[hit.project_name, hit.tags?.map((tg) => `#${tg}`).join(' '), formatDateTime(hit.updated_at)].filter(Boolean).join(' · ')}
                </p>
              </li>
            )
          })}
        </ol>
        <Pagination page={current.page} size={PAGE_SIZE} total={data.total} onPage={(page) => setParams(writeParams({ ...current, page }))} />
      </div>
    )

  return (
    <>
      <PageHeader title={t('nav.search')} description={t('search.description')} />
      <div className="grid grid-cols-1 gap-6">
        <div role="search" className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_12rem_12rem] md:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="search-q">{t('search.label')}</Label>
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" aria-hidden="true" />
              <Input
                id="search-q"
                type="search"
                autoFocus
                className="pl-9"
                maxLength={200}
                placeholder={t('search.placeholder')}
                aria-describedby="search-hint"
                value={text}
                onChange={(e) => type(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="search-kind">{t('search.kind')}</Label>
            <NativeSelect id="search-kind" value={current.kind} onChange={(e) => update({ kind: e.target.value as SearchKind })}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`search.kinds.${k}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="search-tag">{t('search.tag')}</Label>
            <NativeSelect id="search-tag" value={current.tag[0] ?? ''} onChange={(e) => update({ tag: e.target.value ? [e.target.value] : [] })}>
              <option value="">{t('search.anyTag')}</option>
              {tags?.map((tg) => (
                <option key={tg.name} value={tg.name}>
                  #{tg.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <p id="search-hint" className="text-muted-foreground text-xs md:col-span-3">
            {t('search.hint')}
          </p>
        </div>
        {results}
      </div>
    </>
  )
}
