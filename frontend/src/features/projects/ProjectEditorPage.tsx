import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'

import { ApiError } from '@/shared/api/client'
import { apiErrorMessage } from '@/shared/api/errors'
import { useToast } from '@/shared/components/toast'
import { FullPageStatus } from '@/shared/layout/FullPageStatus'
import { PageHeader } from '@/shared/layout/PageHeader'

import { useProject, useSaveProject } from './api'
import { ProjectForm } from './components/ProjectForm'
import { ProjectNotFound } from './components/ProjectNotFound'
import { parseProjectId } from './params'
import type { Project } from './types'

function Editor({ project }: { project?: Project }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()
  const save = useSaveProject(project?.id ?? null)

  return (
    <>
      <PageHeader title={project ? t('projects.edit') : t('projects.new')} description={project?.name} />
      <ProjectForm
        initial={project}
        submitLabel={project ? t('projects.form.save') : t('projects.form.create')}
        pending={save.isPending}
        error={save.error}
        onCancel={() => navigate(project ? `/projects/${project.id}` : '/projects')}
        onSubmit={(input) =>
          save.mutate(input, {
            onSuccess: (saved) => {
              toast({ tone: 'success', message: t(project ? 'projects.toast.saved' : 'projects.toast.created') })
              navigate(`/projects/${saved.id}`, { replace: !project })
            },
          })
        }
      />
    </>
  )
}

/** /projects/new */
export function ProjectNewPage() {
  return <Editor />
}

/** /projects/:projectId/edit — the form only mounts once the project is loaded. */
export function ProjectEditPage() {
  const { t } = useTranslation()
  const id = parseProjectId(useParams().projectId)
  const { data, isPending, error } = useProject(id)
  if (id === null || (error instanceof ApiError && error.status === 404)) return <ProjectNotFound />
  if (isPending) return <FullPageStatus kind="loading" />
  if (error) return <p role="alert" className="text-danger text-sm">{apiErrorMessage(t, error)}</p>
  return <Editor key={data.updated_at} project={data} />
}
