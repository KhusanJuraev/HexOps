import { Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DateInput } from '@/shared/components/DateInput'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { NativeSelect } from '@/shared/ui/native-select'

import { useProjectOptions } from '../api'
import { REPORT_SORTS, REPORT_STATUSES, REPORT_TYPES, SEVERITIES, type ReportQuery } from '../types'

interface Props {
  query: ReportQuery
  onChange: (patch: Partial<ReportQuery>) => void
  onClear: () => void
  filtered: boolean
}

export function ReportFilters({ query, onChange, onClear, filtered }: Props) {
  const { t } = useTranslation()
  const [text, setText] = useState(query.q)
  const [syncedQ, setSyncedQ] = useState(query.q)
  const timer = useRef<number | undefined>(undefined)
  const { data: projects } = useProjectOptions('')

  if (query.q !== syncedQ) {
    setSyncedQ(query.q)
    setText(query.q)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])

  // Sent once typing pauses for 300 ms, never per keystroke.
  const type = (value: string) => {
    setText(value)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => onChange({ q: value }), 300)
  }

  const select = <K extends keyof ReportQuery>(id: string, label: string, key: K, all: string, values: readonly string[], prefix: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect id={id} value={String(query[key] ?? '')} onChange={(e) => onChange({ [key]: e.target.value } as Partial<ReportQuery>)}>
        <option value="">{all}</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {t(`${prefix}.${v}`)}
          </option>
        ))}
      </NativeSelect>
    </div>
  )

  return (
    <div role="search" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 xl:items-end">
      <div className="grid gap-1.5 sm:col-span-2 lg:col-span-3 xl:col-span-2">
        <Label htmlFor="report-search">{t('reports.search')}</Label>
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" aria-hidden="true" />
          <Input
            id="report-search"
            type="search"
            className="pl-9"
            placeholder={t('reports.searchPlaceholder')}
            maxLength={200}
            value={text}
            onChange={(e) => type(e.target.value)}
          />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="report-project">{t('reports.filterProject')}</Label>
        <NativeSelect
          id="report-project"
          value={query.project_id ?? ''}
          onChange={(e) => onChange({ project_id: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">{t('reports.allProjects')}</option>
          {projects?.items.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      {select('report-type', t('reports.filterType'), 'type', t('reports.allTypes'), REPORT_TYPES, 'reports.type')}
      {select('report-severity', t('reports.filterSeverity'), 'severity', t('reports.allSeverities'), SEVERITIES, 'reports.severity')}
      {select('report-status', t('reports.filterStatus'), 'status', t('reports.allStatuses'), REPORT_STATUSES, 'reports.status')}
      <div className="grid gap-1.5">
        <Label htmlFor="report-created-from">{t('reports.createdFrom')}</Label>
        <DateInput id="report-created-from" value={query.created_from} onChange={(v) => onChange({ created_from: v })} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="report-created-to">{t('reports.createdTo')}</Label>
        <DateInput id="report-created-to" value={query.created_to} onChange={(v) => onChange({ created_to: v })} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="report-sort">{t('reports.sortBy')}</Label>
        <NativeSelect
          id="report-sort"
          value={`${query.sort}:${query.order}`}
          onChange={(e) => {
            const [sort, order] = e.target.value.split(':') as [ReportQuery['sort'], ReportQuery['order']]
            onChange({ sort, order })
          }}
        >
          {REPORT_SORTS.flatMap((field) =>
            (['desc', 'asc'] as const).map((order) => (
              <option key={`${field}:${order}`} value={`${field}:${order}`}>
                {t(`reports.sort.${field}`)} · {t(`reports.order.${order}`)}
              </option>
            )),
          )}
        </NativeSelect>
      </div>
      {filtered && (
        <Button type="button" variant="ghost" size="sm" className="w-fit" onClick={onClear}>
          <X aria-hidden="true" />
          {t('reports.clearFilters')}
        </Button>
      )}
    </div>
  )
}
