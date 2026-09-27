import { Download, FileUp, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { apiErrorMessage } from '@/shared/api/errors'
import { ConfirmButton } from '@/shared/components/ConfirmButton'
import { useToast } from '@/shared/components/toast'
import { formatDateTime } from '@/shared/lib/format'
import { Button } from '@/shared/ui/button'

import { downloadUrl, useAttachments, useDeleteAttachment, useEvidenceLimits, useUploadAttachment } from '../api'

const ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.log,.md,.csv,.json,.xml,.yaml,.yml,.har,.http,.req,.py,.js,.ts,.rb,.go,.c,.h,.cpp,.java,.php,.sh,.ps1,.sql,.html,.htm'
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024 // shown until the server's configured limit loads

function formatSize(bytes: number, locale: string) {
  const units = ['B', 'KB', 'MB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: i ? 1 : 0 }).format(n)} ${units[i]}`
}

/** Own queries and error states. Downloads are plain links: always saved, never shown. */
export function EvidenceSection({ reportId }: { reportId: number }) {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const { data: limits } = useEvidenceLimits()
  const { data, isPending, isError, error, refetch } = useAttachments(reportId)
  const upload = useUploadAttachment(reportId)
  const remove = useDeleteAttachment(reportId)
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [failures, setFailures] = useState<string[]>([])

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return
    const failed: string[] = []
    for (const file of Array.from(files)) {
      setBusy(file.name)
      try {
        await upload.mutateAsync(file)
        toast({ tone: 'success', message: t('reports.evidence.uploaded', { name: file.name }) })
      } catch (err) {
        failed.push(t('reports.evidence.failed', { name: file.name, reason: apiErrorMessage(t, err) }))
      }
    }
    setBusy(null)
    setFailures(failed)
    if (input.current) input.current.value = ''
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="grid gap-2">
        <input
          ref={input}
          id="evidence-input"
          type="file"
          multiple
          accept={ACCEPT}
          // Not focusable itself: the visible button below is the one control.
          className="hidden"
          aria-label={t('reports.evidence.upload')}
          onChange={(e) => void onFiles(e.target.files)}
        />
        <Button variant="outline" className="w-fit" disabled={busy !== null} onClick={() => input.current?.click()}>
          <FileUp aria-hidden="true" />
          {busy ? t('reports.evidence.uploading', { name: busy }) : t('reports.evidence.upload')}
        </Button>
        <p className="text-muted-foreground text-xs">
          {t('reports.evidence.hint', { size: Math.round(((limits?.max_bytes ?? DEFAULT_MAX_BYTES) / 1024 / 1024) * 10) / 10 })}
        </p>
        {failures.length > 0 && (
          <ul role="alert" className="text-danger grid gap-1 text-sm">
            {failures.map((f) => (
              <li key={f} className="break-words">
                {f}
              </li>
            ))}
          </ul>
        )}
      </div>
      {isPending ? (
        <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
      ) : isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          <p>{apiErrorMessage(t, error)}</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : data.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('reports.evidence.empty')}</p>
      ) : (
        <ul className="divide-y">
          {data.map((a) => (
            <li key={a.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
              <span className="min-w-0 flex-1 basis-48">
                <span className="block text-sm font-medium break-all">{a.original_name}</span>
                <span className="text-muted-foreground block text-xs">
                  {formatSize(a.size_bytes, i18n.resolvedLanguage ?? 'en')} · {formatDateTime(a.created_at)}
                </span>
              </span>
              <span className="flex gap-1">
                <Button asChild variant="ghost" size="icon">
                  <a href={downloadUrl(reportId, a.id)} download aria-label={t('reports.evidence.download', { name: a.original_name })}>
                    <Download aria-hidden="true" />
                  </a>
                </Button>
                <ConfirmButton
                  variant="ghost"
                  size="icon"
                  label={t('reports.evidence.remove', { name: a.original_name })}
                  title={t('reports.evidence.removeTitle')}
                  body={t('reports.evidence.removeBody', { name: a.original_name })}
                  confirmLabel={t('common.delete')}
                  onConfirm={() =>
                    remove.mutate(a.id, { onError: (err) => toast({ tone: 'error', message: apiErrorMessage(t, err) }) })
                  }
                >
                  <Trash2 aria-hidden="true" />
                </ConfirmButton>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
