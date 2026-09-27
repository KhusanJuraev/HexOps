import { FolderKanban } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'

import { useImportDraft, type ImportDraft } from '@/features/pdf'
import { ApiError } from '@/shared/api/client'
import { apiErrorMessage } from '@/shared/api/errors'
import { EmptyState } from '@/shared/components/EmptyState'
import { useUnsavedChanges } from '@/shared/components/UnsavedChanges'
import { useToast } from '@/shared/components/toast'
import { FullPageStatus } from '@/shared/layout/FullPageStatus'
import { PageHeader } from '@/shared/layout/PageHeader'
import { Button } from '@/shared/ui/button'

import { useProjectOptions, useReport, useSaveReport } from './api'
import { ReportForm } from './components/ReportForm'
import { ReportNotFound } from './components/ReportNotFound'
import { parseId } from './params'
import type { Report } from './types'

function Editor({ report, projectId, draft }: { report?: Report; projectId?: number | null; draft?: ImportDraft }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()
  const save = useSaveReport(report?.id ?? null)
  const [dirty, setDirty] = useState(false)
  const guard = useUnsavedChanges(dirty)
  return (
    <>
      {guard.dialog}
      <PageHeader title={report ? t('reports.edit') : t('reports.new')} description={report?.title ?? (draft ? t('pdf.import.fromDraft') : undefined)} />
      <ReportForm
        initial={report}
        initialProjectId={projectId}
        draft={draft}
        submitLabel={report ? t('reports.form.save') : t('reports.form.create')}
        pending={save.isPending}
        error={save.error}
        onDirtyChange={setDirty}
        onCancel={() => navigate(report ? `/reports/${report.id}` : '/reports')}
        onSubmit={(input) =>
          save.mutate(input, {
            onSuccess: (saved) => {
              guard.release()
              toast({ tone: 'success', message: t(report ? 'reports.toast.saved' : 'reports.toast.created') })
              navigate(`/reports/${saved.id}`, { replace: !report })
            },
          })
        }
      />
    </>
  )
}

/** /reports/new, optionally ?project_id= from a project page. */
export function ReportNewPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const draft = useImportDraft()
  const { data, isPending } = useProjectOptions('')
  if (isPending) return <FullPageStatus kind="loading" />
  if (data && data.total === 0)
    return (
      <EmptyState
        as="h1"
        icon={FolderKanban}
        title={t('reports.new')}
        description={t('reports.empty.noProjects')}
        action={
          <Button asChild>
            <Link to="/projects/new">{t('projects.new')}</Link>
          </Button>
        }
      />
    )
  return <Editor projectId={parseId(params.get('project_id'))} draft={draft} />
}

/** /reports/:reportId/edit — the form mounts once the report is loaded. */
export function ReportEditPage() {
  const { t } = useTranslation()
  const id = parseId(useParams().reportId)
  const { data, isPending, error } = useReport(id)
  if (id === null || (error instanceof ApiError && error.status === 404)) return <ReportNotFound />
  if (isPending) return <FullPageStatus kind="loading" />
  if (error) return <p role="alert" className="text-danger text-sm">{apiErrorMessage(t, error)}</p>
  return <Editor key={data.updated_at} report={data} />
}
