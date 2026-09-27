import { Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'

import { ActivityList } from '@/features/activity'
import { ProjectNotesSection } from '@/features/notes'
import { ProjectReportsSection } from '@/features/reports'
import { ApiError } from '@/shared/api/client'
import { apiErrorMessage } from '@/shared/api/errors'
import { Badge } from '@/shared/components/Badge'
import { Section } from '@/shared/components/Section'
import { FullPageStatus } from '@/shared/layout/FullPageStatus'
import { PageHeader } from '@/shared/layout/PageHeader'
import { formatDate, formatDateTime } from '@/shared/lib/format'
import { Button } from '@/shared/ui/button'

import { useProject } from './api'
import { StatusBadge, TypeBadge } from './components/Badges'
import { DeleteProjectButton } from './components/DeleteProjectButton'
import { ProjectNotFound } from './components/ProjectNotFound'
import { parseProjectId } from './params'

export default function ProjectDetailPage() {
  const { t } = useTranslation()
  const id = parseProjectId(useParams().projectId)
  const { data: project, isPending, isError, error, refetch } = useProject(id)

  if (id === null || (error instanceof ApiError && error.status === 404)) return <ProjectNotFound />
  if (isPending) return <FullPageStatus kind="loading" />
  if (isError)
    return (
      <div role="alert" className="bg-card flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm">
        <p className="flex-1">{apiErrorMessage(t, error)}</p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    )

  const meta = [
    project.start_date && t('projects.detail.started', { date: formatDate(project.start_date) }),
    t('projects.detail.updated', { date: formatDateTime(project.updated_at) }),
  ].filter(Boolean)

  return (
    <>
      <PageHeader
        title={project.name}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to={`/projects/${project.id}/edit`}>
                <Pencil aria-hidden="true" />
                {t('common.edit')}
              </Link>
            </Button>
            <DeleteProjectButton id={project.id} name={project.name} />
          </div>
        }
      />
      <div className="-mt-4 mb-8 grid gap-2">
        <div className="flex flex-wrap gap-2">
          <TypeBadge type={project.type} />
          <StatusBadge status={project.status} />
        </div>
        <p className="text-muted-foreground text-sm">{meta.join(' · ')}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 content-start gap-6">
          <Section id="section-description" title={t('projects.detail.description')}>
            {project.description ? (
              <p className="text-sm break-words whitespace-pre-wrap">{project.description}</p>
            ) : (
              <p className="text-muted-foreground text-sm">{t('projects.detail.noDescription')}</p>
            )}
          </Section>
          <Section id="section-scope" title={`${t('projects.detail.scope')} (${project.scope.length})`}>
            {project.scope.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('projects.detail.noScope')}</p>
            ) : (
              <ol className="divide-y">
                {project.scope.map((item, i) => (
                  <li key={i} className="grid grid-cols-1 gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
                    <span>
                      <Badge>{t(`projects.kind.${item.kind}`)}</Badge>
                    </span>
                    <span className="min-w-0">
                      <code className="block font-mono text-sm break-all">{item.value}</code>
                      {item.note && <span className="text-muted-foreground block text-xs break-words">{item.note}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Section>
          <Section id="section-reports" title={t('projects.detail.reports')}>
            <ProjectReportsSection projectId={project.id} />
          </Section>
          <Section id="section-notes" title={t('projects.detail.notes')}>
            <ProjectNotesSection projectId={project.id} />
          </Section>
        </div>
        <div className="min-w-0">
          <Section id="section-activity" title={t('projects.detail.activity')}>
            <ActivityList scope={{ projectId: project.id }} showRecord />
          </Section>
        </div>
      </div>
    </>
  )
}
