import { FolderKanban, Plus, SearchX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'

import { apiErrorMessage } from '@/shared/api/errors'
import { EmptyState } from '@/shared/components/EmptyState'
import { Pagination } from '@/shared/components/Pagination'
import { FullPageStatus } from '@/shared/layout/FullPageStatus'
import { PageHeader } from '@/shared/layout/PageHeader'
import { formatDate, formatDateTime } from '@/shared/lib/format'
import { Button } from '@/shared/ui/button'

import { DEFAULT_QUERY, PAGE_SIZE, toSearchParams, useProjects } from './api'
import { StatusBadge, TypeBadge } from './components/Badges'
import { ProjectFilters } from './components/ProjectFilters'
import { parseQuery } from './params'
import type { ProjectListItem, ProjectQuery } from './types'

function ProjectTable({ items }: { items: ProjectListItem[] }) {
  const { t } = useTranslation()
  return (
    <div className="bg-card hidden overflow-x-auto rounded-xl border md:block">
      <table className="w-full text-sm">
        <thead className="text-muted-foreground border-b text-left text-xs">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">{t('projects.columns.name')}</th>
            <th scope="col" className="px-4 py-3 font-medium">{t('projects.columns.type')}</th>
            <th scope="col" className="px-4 py-3 font-medium">{t('projects.columns.status')}</th>
            <th scope="col" className="px-4 py-3 font-medium">{t('projects.columns.startDate')}</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">{t('projects.columns.scope')}</th>
            <th scope="col" className="px-4 py-3 font-medium">{t('projects.columns.updated')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id} className="border-b last:border-0">
              <td className="max-w-72 px-4 py-3">
                <Link to={`/projects/${p.id}`} className="font-medium break-words hover:underline focus-visible:underline">
                  {p.name}
                </Link>
              </td>
              <td className="px-4 py-3"><TypeBadge type={p.type} /></td>
              <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
              <td className="px-4 py-3 whitespace-nowrap">{formatDate(p.start_date) || t('projects.noStartDate')}</td>
              <td className="px-4 py-3 text-right tabular-nums">{p.scope_count}</td>
              <td className="text-muted-foreground px-4 py-3 whitespace-nowrap">{formatDateTime(p.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ProjectCards({ items }: { items: ProjectListItem[] }) {
  const { t } = useTranslation()
  return (
    <ul className="grid grid-cols-1 gap-3 md:hidden">
      {items.map((p) => (
        <li key={p.id}>
          <Link
            to={`/projects/${p.id}`}
            className="bg-card focus-visible:ring-ring/50 block rounded-xl border p-4 outline-none focus-visible:ring-[3px]"
          >
            <span className="block font-medium break-words">{p.name}</span>
            <span className="mt-2 flex flex-wrap gap-2">
              <TypeBadge type={p.type} />
              <StatusBadge status={p.status} />
            </span>
            <span className="text-muted-foreground mt-2 block text-xs">
              {[formatDate(p.start_date), t('projects.assetCount', { count: p.scope_count })].filter(Boolean).join(' · ')}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export default function ProjectsPage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const query = parseQuery(params)
  const { data, isPending, isError, error, refetch, isPlaceholderData } = useProjects(query)
  const filtered = Boolean(query.q || query.type || query.status)

  // Filters live in the URL: shareable, and Back restores them. Changing one resets the page.
  // Functional update: a delayed search must not undo a filter chosen meanwhile.
  const update = (patch: Partial<ProjectQuery>) =>
    setParams((prev) => toSearchParams({ ...parseQuery(prev), page: 1, ...patch }), { replace: 'q' in patch })
  const clear = () => setParams(toSearchParams({ ...DEFAULT_QUERY, sort: query.sort, order: query.order }))

  let body: React.ReactNode
  if (isPending) body = <FullPageStatus kind="loading" />
  else if (isError)
    body = (
      <div role="alert" className="bg-card flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm">
        <p className="flex-1">{apiErrorMessage(t, error)}</p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    )
  else if (data.total === 0 && !filtered)
    body = (
      <EmptyState
        icon={FolderKanban}
        title={t('projects.empty.title')}
        description={t('projects.empty.body')}
        action={
          <Button asChild>
            <Link to="/projects/new">{t('projects.new')}</Link>
          </Button>
        }
      />
    )
  else if (data.items.length === 0)
    body = (
      <EmptyState
        icon={SearchX}
        title={t('projects.empty.filteredTitle')}
        description={t('projects.empty.filteredBody')}
        action={
          <Button variant="outline" onClick={clear}>
            {t('projects.clearFilters')}
          </Button>
        }
      />
    )
  else
    body = (
      <div className={isPlaceholderData ? 'grid grid-cols-1 gap-4 opacity-60 transition-opacity' : 'grid grid-cols-1 gap-4'} aria-busy={isPlaceholderData}>
        <ProjectTable items={data.items} />
        <ProjectCards items={data.items} />
        <Pagination page={query.page} size={PAGE_SIZE} total={data.total} onPage={(page) => update({ page })} />
      </div>
    )

  return (
    <>
      <PageHeader
        title={t('nav.projects')}
        description={t('modules.projects')}
        actions={
          <Button asChild>
            <Link to="/projects/new">
              <Plus aria-hidden="true" />
              {t('projects.new')}
            </Link>
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-6">
        <ProjectFilters query={query} onChange={update} onClear={clear} filtered={filtered} />
        {body}
      </div>
    </>
  )
}
