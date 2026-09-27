import { FileText, LoaderCircle, NotebookPen, RotateCcw, TriangleAlert, Upload } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { apiErrorMessage } from '@/shared/api/errors'
import { FormField } from '@/shared/components/FormField'
import { MarkdownEditor } from '@/shared/components/markdown'
import { Section } from '@/shared/components/Section'
import { useUnsavedChanges } from '@/shared/components/UnsavedChanges'
import { PageHeader } from '@/shared/layout/PageHeader'
import { Button } from '@/shared/ui/button'

import { discardJob, isFinished, useCreateImport, useImportLimits, useJob, type PdfJob } from './api'
import type { ImportDraftState } from './draftState'
import { jobErrorMessage, warningMessage } from './messages'

const MAX_BODY = 200_000
const MAX_TITLE = 300

function Review({ job, onRestart }: { job: PdfJob; onRestart: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [title, setTitle] = useState(job.draft?.title ?? '')
  const [body, setBody] = useState(job.draft?.markdown ?? '')
  // The draft exists only here until it is saved as a new record.
  const guard = useUnsavedChanges(true)

  const continueAs = (target: 'reports' | 'notes') => {
    guard.release()
    const state: ImportDraftState = { importDraft: { title: title.slice(0, MAX_TITLE), body_md: body } }
    navigate(`/${target}/new`, { state })
    discardJob(job.id)
  }

  return (
    <>
      {guard.dialog}
      <div role="note" className="bg-card flex gap-3 rounded-xl border px-4 py-3 text-sm">
        <TriangleAlert className="text-warning mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="grid gap-1">
          <p className="font-medium">{t('pdf.import.reviewTitle', { pages: job.page_count ?? 0 })}</p>
          <p className="text-muted-foreground">{t('pdf.import.manualCorrection')}</p>
          {job.warnings.length > 0 && (
            <ul className="text-muted-foreground list-disc pl-5" aria-label={t('pdf.import.warnings')}>
              {job.warnings.map((code) => (
                <li key={code}>{warningMessage(t, code)}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <Section id="section-draft" title={t('pdf.import.draft')}>
        <div className="grid gap-4">
          <FormField id="import-title" label={t('pdf.import.draftTitle')} value={title} maxLength={MAX_TITLE} onChange={(e) => setTitle(e.target.value)} />
          <MarkdownEditor id="import-body" label={t('pdf.import.draftBody')} value={body} onChange={setBody} maxLength={MAX_BODY} hint={t('pdf.import.draftHint')} />
        </div>
      </Section>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => continueAs('reports')} disabled={!title.trim()}>
          <FileText aria-hidden="true" />
          {t('pdf.import.asReport')}
        </Button>
        <Button variant="outline" onClick={() => continueAs('notes')} disabled={!title.trim()}>
          <NotebookPen aria-hidden="true" />
          {t('pdf.import.asNote')}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            guard.release()
            discardJob(job.id)
            onRestart()
          }}
        >
          <RotateCcw aria-hidden="true" />
          {t('pdf.import.startOver')}
        </Button>
      </div>
    </>
  )
}

/** /import: a text PDF becomes a Markdown draft, reviewed before it becomes a NEW record. */
export default function ImportPage() {
  const { t } = useTranslation()
  const [file, setFile] = useState<File | null>(null)
  const [jobId, setJobId] = useState<number | null>(null)
  const [attempt, setAttempt] = useState(0)
  const upload = useCreateImport()
  const { data: limits } = useImportLimits()
  const input = useRef<HTMLInputElement>(null)
  const { data: job, error: pollError } = useJob(jobId)

  const restart = () => {
    setJobId(null)
    setFile(null)
    upload.reset()
    setAttempt((n) => n + 1) // remount the file input so the same file can be chosen again
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (file) upload.mutate(file, { onSuccess: (started) => setJobId(started.id) })
  }

  const working = upload.isPending || (jobId !== null && !pollError && !isFinished(job))
  const failure = upload.error
    ? apiErrorMessage(t, upload.error)
    : pollError
      ? apiErrorMessage(t, pollError)
      : job?.status === 'failed'
        ? jobErrorMessage(t, job.error_code)
        : null

  return (
    <>
      <PageHeader title={t('pdf.import.title')} description={t('pdf.import.description')} />
      <div className="grid grid-cols-1 gap-6">
        {job?.status === 'done' && job.draft ? (
          <Review key={job.id} job={job} onRestart={restart} />
        ) : (
          <Section id="section-upload" title={t('pdf.import.choose')}>
            <form onSubmit={submit} className="grid gap-4" aria-busy={working}>
              <ul className="text-muted-foreground list-disc pl-5 text-sm">
                {limits && <li>{t('pdf.import.limits', { mb: Math.round((limits.max_bytes / 1024 / 1024) * 10) / 10, pages: limits.max_pages })}</li>}
                <li>{t('pdf.import.textOnly')}</li>
                <li>{t('pdf.import.manualCorrection')}</li>
                <li>{t('pdf.import.neverOverwrites')}</li>
              </ul>
              <div className="grid gap-2">
                <p className="text-sm font-medium">{t('pdf.import.file')}</p>
                {/* The native picker's own text follows the browser's language, not HexOps':
                    a translated button opens it instead (as for evidence). */}
                <input
                  key={attempt}
                  ref={input}
                  id="import-file"
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  aria-label={t('pdf.import.file')}
                  disabled={working}
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null)
                    setJobId(null)
                    upload.reset()
                  }}
                />
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                  <Button type="button" variant="outline" disabled={working} onClick={() => input.current?.click()}>
                    <FileText aria-hidden="true" />
                    {t('pdf.import.pick')}
                  </Button>
                  <span className="text-muted-foreground min-w-0 text-sm break-all" aria-live="polite">
                    {file ? file.name : t('pdf.import.noFile')}
                  </span>
                </div>
              </div>
              {working && (
                <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  {upload.isPending ? t('pdf.import.uploading') : t('pdf.import.working', { progress: job?.progress ?? 0 })}
                </p>
              )}
              {failure && (
                <p role="alert" className="text-danger text-sm">
                  {failure}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={!file || working}>
                  <Upload aria-hidden="true" />
                  {t('pdf.import.submit')}
                </Button>
              </div>
            </form>
          </Section>
        )}
      </div>
    </>
  )
}
