import { Undo2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { apiErrorMessage, fieldErrorMessage, fieldErrorsOf } from '@/shared/api/errors'
import { ConfirmButton } from '@/shared/components/ConfirmButton'
import { useToast } from '@/shared/components/toast'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/lib/utils'
import { DateInput } from '@/shared/components/DateInput'
import { localDateTimeToIso, parseTimeInput } from '@/shared/lib/format'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'

import { useChangeStatus } from '../api'
import type { Report, ReportStatus } from '../types'
import { ReportStatusBadge } from './Badges'

/**
 * Offers only the moves the server allows (next_statuses, correction_to); the
 * server still checks every request. Errors are translated from their code.
 */
// Translated labels can be long and this panel can be a narrow side column: let them wrap.
const WRAP = 'h-auto min-h-9 max-w-full shrink py-2 text-left whitespace-normal'

export function StatusPanel({ report }: { report: Report }) {
  const { t } = useTranslation()
  const toast = useToast()
  const change = useChangeStatus(report.id)
  // The date of a step (e.g. when it was paid): a calendar day plus a 24-hour time in the
  // viewer's time zone, sent as a UTC instant. Both empty = now.
  const [day, setDay] = useState('')
  const [dayError, setDayError] = useState<string | null>(null)
  const [time, setTime] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const status = (s: ReportStatus) => t(`reports.status.${s}`)

  /** The `at` to send: undefined for "now", null when the entry is incomplete or invalid. */
  const at = (): string | undefined | null => {
    const parsedTime = parseTimeInput(time)
    if (dayError) return null
    if (!day && 'empty' in parsedTime) return undefined
    if ('error' in parsedTime) return setLocalError(t('dates.errors.time_format')), null
    if (!day) return setLocalError(t('dates.errors.date_required')), null
    if ('empty' in parsedTime) return setLocalError(t('dates.errors.time_required')), null
    return localDateTimeToIso(day, parsedTime)
  }

  const move = (to: ReportStatus, correction = false) => {
    setLocalError(null)
    const when = correction ? undefined : at()
    if (when === null) return
    change.mutate(
      { to, ...(correction ? { correction: true } : {}), ...(when ? { at: when } : {}) },
      {
        onSuccess: () => {
          setDay('')
          setTime('')
          toast({ tone: 'success', message: t(correction ? 'reports.workflow.corrected' : 'reports.workflow.changed', { status: status(to) }) })
        },
      },
    )
  }

  const whenError = fieldErrorsOf(change.error).at
  const formError = change.error && !whenError ? apiErrorMessage(t, change.error) : null

  return (
    <div className="grid grid-cols-1 gap-4">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className="sr-only">{t('reports.workflow.current', { status: status(report.status) })}</span>
        <ReportStatusBadge status={report.status} />
      </p>
      {report.next_statuses.length > 0 ? (
        <>
          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 text-sm leading-none font-medium">{t('reports.workflow.when')}</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,12rem)_6rem]">
              <div className="grid gap-1">
                <Label htmlFor="status-when" className="text-muted-foreground text-xs font-normal">
                  {t('dates.date')}
                </Label>
                <DateInput
                  id="status-when"
                  value={day}
                  describedBy="status-when-hint"
                  onErrorChange={setDayError}
                  onChange={(v) => {
                    setDay(v)
                    setLocalError(null)
                    change.reset()
                  }}
                />
              </div>
              <div className="grid content-start gap-1">
                <Label htmlFor="status-when-time" className="text-muted-foreground text-xs font-normal">
                  {t('dates.time')}
                </Label>
                <Input
                  id="status-when-time"
                  inputMode="numeric"
                  placeholder={t('dates.timePlaceholder')}
                  maxLength={5}
                  className="tabular-nums"
                  aria-describedby="status-when-hint"
                  aria-invalid={localError || whenError ? true : undefined}
                  value={time}
                  onChange={(e) => {
                    setTime(e.target.value)
                    setLocalError(null)
                    change.reset()
                  }}
                />
              </div>
            </div>
            <p id="status-when-hint" className={localError || whenError ? 'text-danger text-sm' : 'text-muted-foreground text-xs'}>
              {localError ?? (whenError ? fieldErrorMessage(t, whenError) : t('reports.workflow.whenHint'))}
            </p>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            {report.next_statuses.map((to) => (
              <Button key={to} className={WRAP} disabled={change.isPending} onClick={() => move(to)}>
                {t('reports.workflow.moveTo', { status: status(to) })}
              </Button>
            ))}
          </div>
        </>
      ) : (
        <p className="text-muted-foreground text-sm">{t('reports.workflow.final')}</p>
      )}
      {report.correction_to && (
        <ConfirmButton
          variant="ghost"
          className={cn(WRAP, 'w-fit')}
          title={t('reports.workflow.undoTitle')}
          body={t('reports.workflow.undoBody', { status: status(report.correction_to) })}
          confirmLabel={t('reports.workflow.undo', { status: status(report.correction_to) })}
          pending={change.isPending}
          onConfirm={() => move(report.correction_to!, true)}
        >
          <Undo2 aria-hidden="true" />
          {t('reports.workflow.undo', { status: status(report.correction_to) })}
        </ConfirmButton>
      )}
      {formError && (
        <p role="alert" className="text-danger text-sm">
          {formError}
        </p>
      )}
    </div>
  )
}
