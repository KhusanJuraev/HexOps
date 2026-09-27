import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { apiErrorMessage } from '@/shared/api/errors'
import { useToast } from '@/shared/components/toast'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/shared/ui/alert-dialog'
import { Button } from '@/shared/ui/button'

import { useDeleteProject } from '../api'

export function DeleteProjectButton({ id, name }: { id: number; name: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()
  const remove = useDeleteProject(id)

  const confirm = () =>
    remove.mutate(undefined, {
      onSuccess: () => {
        toast({ tone: 'success', message: t('projects.toast.deleted') })
        navigate('/projects', { replace: true })
      },
      // 409 project_has_reports is translated via errors.codes.*
      onError: (err) => toast({ tone: 'error', message: apiErrorMessage(t, err) }),
    })

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline">
          <Trash2 aria-hidden="true" />
          {t('common.delete')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>{t('projects.deleteDialog.title')}</AlertDialogTitle>
        <AlertDialogDescription className="break-words">{t('projects.deleteDialog.body', { name })}</AlertDialogDescription>
        <div className="flex flex-wrap justify-end gap-2">
          <AlertDialogCancel asChild>
            <Button variant="outline">{t('common.cancel')}</Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button variant="destructive" onClick={confirm} disabled={remove.isPending}>
              {t('projects.deleteDialog.confirm')}
            </Button>
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
