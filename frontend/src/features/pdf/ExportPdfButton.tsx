import { Download, FileDown, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { apiErrorMessage } from '@/shared/api/errors'
import { useToast } from '@/shared/components/toast'
import { Button } from '@/shared/ui/button'

import { downloadUrl, exportLang, isFinished, useCreateExport, useJob, type SourceType } from './api'
import { jobErrorMessage } from './messages'

/**
 * "Export PDF" for a saved report or note. The PDF is made in the background; the
 * button shows progress, then turns into a download link. Unsaved edits are not
 * included: the export prints what is stored.
 */
export function ExportPdfButton({ sourceType, sourceId }: { sourceType: SourceType; sourceId: number }) {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const [jobId, setJobId] = useState<number | null>(null)
  const create = useCreateExport()
  const { data: job, error } = useJob(jobId)
  const announced = useRef<number | null>(null)

  useEffect(() => {
    if (!job || !isFinished(job) || announced.current === job.id) return
    announced.current = job.id
    if (job.status === 'done') toast({ tone: 'success', message: t('pdf.export.ready') })
    else toast({ tone: 'error', message: jobErrorMessage(t, job.error_code) })
  }, [job, t, toast])

  useEffect(() => {
    if (error) toast({ tone: 'error', message: apiErrorMessage(t, error) })
  }, [error, t, toast])

  const start = () =>
    create.mutate(
      { source_type: sourceType, source_id: sourceId, lang: exportLang(i18n.language) },
      {
        onSuccess: (started) => setJobId(started.id),
        onError: (err) => toast({ tone: 'error', message: apiErrorMessage(t, err) }),
      },
    )

  const working = create.isPending || (jobId !== null && !error && !isFinished(job))
  if (job?.status === 'done' && !working)
    return (
      <Button asChild variant="outline">
        <a href={downloadUrl(job)} download={job.result_filename ?? undefined} data-pdf-download>
          <Download aria-hidden="true" />
          {t('pdf.export.download')}
        </a>
      </Button>
    )
  return (
    <Button variant="outline" onClick={start} disabled={working} aria-busy={working}>
      {working ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <FileDown aria-hidden="true" />}
      {working ? t('pdf.export.working', { progress: job?.progress ?? 0 }) : t('pdf.export.button')}
    </Button>
  )
}
