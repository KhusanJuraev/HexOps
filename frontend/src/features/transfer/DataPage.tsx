import { useQueryClient } from '@tanstack/react-query'
import { Download, FileArchive, LoaderCircle, ShieldCheck, TriangleAlert, Upload } from 'lucide-react'
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { apiErrorMessage } from '@/shared/api/errors'
import { ConfirmButton } from '@/shared/components/ConfirmButton'
import { FormField } from '@/shared/components/FormField'
import { Section } from '@/shared/components/Section'
import { PageHeader } from '@/shared/layout/PageHeader'
import { formatDateTime } from '@/shared/lib/format'
import { Button } from '@/shared/ui/button'
import i18n from '@/shared/i18n'

import {
  COUNTED,
  downloadUrl,
  formatBytes,
  isWorking,
  MIN_PASSPHRASE,
  useApply,
  useCheckAgain,
  useCreateExport,
  useTransferJob,
  useTransferState,
  useUploadImport,
  type TransferJob,
} from './api'

function jobError(t: (k: string) => string, code: string | null): string {
  const key = `errors.codes.${code}`
  return code && i18n.exists(key) ? t(key) : t('transfer.failed')
}

function Progress({ job }: { job: TransferJob | undefined }) {
  const { t } = useTranslation()
  return (
    <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
      <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      {t(`transfer.stage.${job?.stage ?? 'queued'}`, { progress: job?.progress ?? 0 })}
    </p>
  )
}

function Alert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-danger text-sm">
      {children}
    </p>
  )
}

/** A passphrase field; `confirm` adds the repeat field and both checks. */
function usePassphrase(id: string, confirm: boolean) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [repeat, setRepeat] = useState('')
  const [touched, setTouched] = useState(false)
  const tooShort = value.length < MIN_PASSPHRASE
  const mismatch = confirm && repeat !== value
  const fields = (
    <>
      <FormField
        id={id}
        type="password"
        autoComplete="new-password"
        label={t('transfer.passphrase')}
        hint={t('transfer.passphraseHint', { min: MIN_PASSPHRASE })}
        error={touched && tooShort ? t('transfer.passphraseShort', { min: MIN_PASSPHRASE }) : null}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      {confirm && (
        <FormField
          id={`${id}-repeat`}
          type="password"
          autoComplete="new-password"
          label={t('transfer.passphraseRepeat')}
          error={touched && mismatch ? t('validation.passwordMismatch') : null}
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
        />
      )}
    </>
  )
  return {
    fields,
    value,
    /** True when usable; otherwise shows the errors. */
    ready: () => {
      setTouched(true)
      return !tooShort && !mismatch
    },
    reset: () => {
      setValue('')
      setRepeat('')
      setTouched(false)
    },
  }
}

function ExportSection() {
  const { t, i18n: lng } = useTranslation()
  const pass = usePassphrase('export-passphrase', true)
  const create = useCreateExport()
  const [jobId, setJobId] = useState<number | null>(null)
  const { data: job, error } = useTransferJob(jobId)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!pass.ready()) return
    create.mutate(pass.value, {
      onSuccess: (started) => {
        setJobId(started.id)
        pass.reset()
      },
    })
  }
  const working = create.isPending || isWorking(job)
  return (
    <Section id="section-export" title={t('transfer.export.title')}>
      <form className="grid max-w-xl gap-4" onSubmit={submit} noValidate>
        <p className="text-muted-foreground text-sm">{t('transfer.export.body')}</p>
        <p className="flex gap-2 text-sm">
          <ShieldCheck className="text-primary mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t('transfer.export.keepSafe')}
        </p>
        {pass.fields}
        {working && <Progress job={job} />}
        {create.error && <Alert>{apiErrorMessage(t, create.error)}</Alert>}
        {error && <Alert>{apiErrorMessage(t, error)}</Alert>}
        {job?.status === 'failed' && <Alert>{jobError(t, job.error_code)}</Alert>}
        {job?.status === 'done' && (
          <div className="bg-muted/50 grid gap-2 rounded-lg border p-3 text-sm" data-export-ready>
            <p className="font-medium">{t('transfer.export.ready')}</p>
            <p className="text-muted-foreground">
              {t('transfer.export.readyDetail', {
                size: formatBytes(job.archive_size ?? 0, lng.language),
                until: formatDateTime(job.expires_at),
              })}
            </p>
            <Button asChild className="w-fit">
              <a href={downloadUrl(job)} download={job.download_name ?? undefined}>
                <Download aria-hidden="true" />
                {t('transfer.export.download')}
              </a>
            </Button>
          </div>
        )}
        <Button type="submit" className="w-fit" disabled={working}>
          <FileArchive aria-hidden="true" />
          {t('transfer.export.submit')}
        </Button>
      </form>
    </Section>
  )
}

function CountsTable({ archive, here }: { archive: Record<string, number>; here: Record<string, number> }) {
  const { t, i18n: lng } = useTranslation()
  const n = (v: number | undefined) => new Intl.NumberFormat(lng.language).format(v ?? 0)
  return (
    <div className="max-w-full overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{t('transfer.import.compare')}</caption>
        <thead className="bg-muted">
          <tr>
            <th scope="col" className="px-3 py-1.5 font-medium">
              {t('transfer.import.kind')}
            </th>
            <th scope="col" className="px-3 py-1.5 text-right font-medium">
              {t('transfer.import.inArchive')}
            </th>
            <th scope="col" className="px-3 py-1.5 text-right font-medium">
              {t('transfer.import.hereNow')}
            </th>
          </tr>
        </thead>
        <tbody>
          {COUNTED.map((k) => (
            <tr key={k} className="border-t" data-count={k}>
              <th scope="row" className="px-3 py-1.5 font-normal">
                {t(`transfer.kinds.${k}`)}
              </th>
              <td className="px-3 py-1.5 text-right tabular-nums">{n(archive[k])}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{n(here[k])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ImportSection() {
  const { t, i18n: lng } = useTranslation()
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [jobId, setJobId] = useState<number | null>(null)
  const [understood, setUnderstood] = useState(false)
  const checkPass = usePassphrase('import-passphrase', false)
  const applyPass = usePassphrase('apply-passphrase', false)
  const upload = useUploadImport()
  const again = useCheckAgain()
  const apply = useApply()
  const { data: job, error } = useTransferJob(jobId)
  const [finished, setFinished] = useState<number | null>(null)

  if (job?.status === 'done' && job.kind === 'import' && finished !== job.id) {
    setFinished(job.id)
    void qc.invalidateQueries() // every page now shows the imported data
  }

  const start = (e: FormEvent) => {
    e.preventDefault()
    if (!file || !checkPass.ready()) return
    upload.mutate({ file, passphrase: checkPass.value }, { onSuccess: (j) => (setJobId(j.id), checkPass.reset()) })
  }
  const retry = (e: FormEvent) => {
    e.preventDefault()
    if (job && checkPass.ready()) again.mutate({ id: job.id, passphrase: checkPass.value }, { onSuccess: () => checkPass.reset() })
  }
  const populated = job?.preview?.target?.populated ?? false
  const doApply = () => {
    if (job && applyPass.ready()) apply.mutate({ id: job.id, passphrase: applyPass.value, replace: populated }, { onSuccess: () => applyPass.reset() })
  }
  const restart = () => {
    setJobId(null)
    setFile(null)
    setUnderstood(false)
    upload.reset()
    apply.reset()
    setAttempt((a) => a + 1)
  }

  const working = upload.isPending || again.isPending || apply.isPending || isWorking(job)
  const requestError = upload.error ?? again.error ?? apply.error ?? error
  const source = job?.preview?.source
  const space = job?.preview?.space

  return (
    <Section id="section-import" title={t('transfer.import.title')}>
      <div className="grid max-w-2xl gap-4">
        <ul className="text-muted-foreground list-disc pl-5 text-sm">
          <li>{t('transfer.import.replaces')}</li>
          <li>{t('transfer.import.backupFirst')}</li>
          <li>{t('transfer.import.account')}</li>
          <li>{t('transfer.import.sameVersion')}</li>
        </ul>

        {!job && (
          <form className="grid gap-4" onSubmit={start} noValidate>
            <div className="grid gap-2">
              <p className="text-sm font-medium">{t('transfer.import.file')}</p>
              <input
                key={attempt}
                ref={input}
                type="file"
                accept=".hexops"
                className="hidden"
                aria-label={t('transfer.import.file')}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <Button type="button" variant="outline" onClick={() => input.current?.click()}>
                  <FileArchive aria-hidden="true" />
                  {t('transfer.import.pick')}
                </Button>
                <span className="text-muted-foreground min-w-0 text-sm break-all">{file ? file.name : t('transfer.import.noFile')}</span>
              </div>
            </div>
            {checkPass.fields}
            <Button type="submit" className="w-fit" disabled={!file || working}>
              <Upload aria-hidden="true" />
              {t('transfer.import.check')}
            </Button>
          </form>
        )}

        {working && <Progress job={job} />}
        {requestError && <Alert>{apiErrorMessage(t, requestError)}</Alert>}

        {job?.status === 'failed' && (
          <div className="grid gap-3" data-import-failed>
            <Alert>{jobError(t, job.error_code)}</Alert>
            {job.error_code === 'transfer_wrong_passphrase' && (
              <form className="grid gap-3" onSubmit={retry} noValidate>
                {checkPass.fields}
                <Button type="submit" className="w-fit" disabled={working}>
                  {t('transfer.import.checkAgain')}
                </Button>
              </form>
            )}
            <Button variant="ghost" className="w-fit" onClick={restart}>
              {t('transfer.import.startOver')}
            </Button>
          </div>
        )}

        {job?.status === 'validated' && source && (
          <div className="grid gap-4" data-import-preview>
            <p className="text-sm font-medium">{t('transfer.import.checked')}</p>
            <p className="text-muted-foreground text-sm">
              {t('transfer.import.source', {
                date: formatDateTime(source.created_at),
                owner: source.source_owner || '—',
                version: source.app_version,
              })}
            </p>
            <CountsTable archive={source.counts} here={job.preview?.target?.counts ?? {}} />
            <p className="text-muted-foreground text-sm">
              {t('transfer.import.files', { count: source.files, size: formatBytes(source.file_bytes, lng.language) })}
            </p>
            {space && (
              <p className={space.needed_bytes > space.free_bytes ? 'text-danger text-sm' : 'text-muted-foreground text-sm'} data-space>
                {t('transfer.import.space', { needed: formatBytes(space.needed_bytes, lng.language), free: formatBytes(space.free_bytes, lng.language) })}
              </p>
            )}
            {populated && (
              <div role="note" className="border-warning/40 bg-warning/10 grid gap-2 rounded-lg border p-3 text-sm">
                <p className="flex gap-2 font-medium">
                  <TriangleAlert className="text-warning mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {t('transfer.import.populatedTitle')}
                </p>
                <p>{t('transfer.import.populatedBody')}</p>
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
                  <span>{t('transfer.import.understand')}</span>
                </label>
              </div>
            )}
            {applyPass.fields}
            <div className="flex flex-wrap gap-2">
              {populated ? (
                <ConfirmButton
                  variant="destructive"
                  disabled={!understood || working}
                  title={t('transfer.import.confirmTitle')}
                  body={t('transfer.import.confirmBody')}
                  confirmLabel={t('transfer.import.replace')}
                  pending={apply.isPending}
                  onConfirm={doApply}
                >
                  {t('transfer.import.replace')}
                </ConfirmButton>
              ) : (
                <Button onClick={doApply} disabled={working}>
                  {t('transfer.import.apply')}
                </Button>
              )}
              <Button variant="ghost" onClick={restart}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}

        {job?.status === 'done' && (
          <div className="bg-muted/50 grid gap-2 rounded-lg border p-3 text-sm" data-import-done>
            <p className="font-medium">{t('transfer.import.done')}</p>
            {job.backup_name && <p className="text-muted-foreground break-all">{t('transfer.import.backupKept', { name: `data/backups/${job.backup_name}` })}</p>}
            <Button variant="outline" className="w-fit" onClick={restart}>
              {t('transfer.import.another')}
            </Button>
          </div>
        )}
      </div>
    </Section>
  )
}

/** Settings → Data: a full, encrypted export of everything, and import (D-90). */
export default function DataPage() {
  const { t } = useTranslation()
  const { data: state } = useTransferState()
  return (
    <>
      <PageHeader title={t('transfer.title')} description={t('transfer.description')} />
      <div className="grid grid-cols-1 gap-6">
        {state && (
          <p className="text-muted-foreground text-sm" data-current-counts>
            {t('transfer.current', {
              projects: state.counts.projects ?? 0,
              reports: state.counts.reports ?? 0,
              notes: state.counts.notes ?? 0,
              files: state.counts.report_attachments ?? 0,
            })}
          </p>
        )}
        <ExportSection />
        <ImportSection />
      </div>
    </>
  )
}
