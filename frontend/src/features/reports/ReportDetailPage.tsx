import { Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'

import { ActivityList } from '@/features/activity'
import { ExportPdfButton } from '@/features/pdf'
import { ApiError } from '@/shared/api/client'
import { apiErrorMessage } from '@/shared/api/errors'
import { ConfirmButton } from '@/shared/components/ConfirmButton'
import { MarkdownView } from '@/shared/components/markdown'
import { Section } from '@/shared/components/Section'
import { useToast } from '@/shared/components/toast'
import { FullPageStatus } from '@/shared/layout/FullPageStatus'
import { PageHeader } from '@/shared/layout/PageHeader'
import { formatDateTime } from '@/shared/lib/format'
import { Button } from '@/shared/ui/button'

import { useAttachments, useDeleteReport, useReport } from './api'
import { ReportStatusBadge, ReportTypeBadge, SeverityBadge } from './components/Badges'
import { EvidenceSection } from './components/EvidenceSection'
import { ReportNotFound } from './components/ReportNotFound'
import { StatusPanel } from './components/StatusPanel'
import { ratingForScore } from './cvss'
import { parseId } from './params'
import { DATE_FIELDS, type Report } from './types'

function formatMoney(amount: string, currency: string, locale: string) {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(amount))
  } catch {
    return `${amount} ${currency}`
  }
}

function Facts({ report }: { report: Report }) {
  const { t, i18n } = useTranslation()
  const suggested = ratingForScore(report.cvss_score)
  const rows: [string, React.ReactNode][] = [
    [t('reports.detail.project'), <Link key="p" to={`/projects/${report.project_id}`} className="break-words hover:underline">{report.project_name}</Link>],
    [t('reports.form.severity'), <SeverityBadge key="s" severity={report.severity} />],
  ]
  if (report.cvss_score || report.cvss_vector)
    rows.push([
      t('reports.detail.cvss'),
      <span key="c" className="grid gap-0.5">
        {report.cvss_score && (
          <span>
            {report.cvss_score}
            {suggested && ` · ${t(`reports.severity.${suggested}`)}`}
          </span>
        )}
        {report.cvss_vector && <code className="font-mono text-xs break-all">{report.cvss_vector}</code>}
      </span>,
    ])
  if (report.bounty_amount && report.bounty_currency)
    rows.push([t('reports.detail.bounty'), formatMoney(report.bounty_amount, report.bounty_currency, i18n.resolvedLanguage ?? 'en')])
  rows.push([t('reports.detail.created'), formatDateTime(report.created_at)])
  for (const field of DATE_FIELDS) {
    const value = report[field]
    if (value) rows.push([t(`reports.detail.dates.${field}`), formatDateTime(value)])
  }
  return (
    // Two columns only when the section itself is wide enough (container query),
    // not when the viewport is: in the narrow side column it stays stacked.
    <div className="@container">
    <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-sm @sm:grid-cols-[9rem_minmax(0,1fr)] @sm:gap-y-2">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground mt-2 first:mt-0 @sm:mt-0">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
    </div>
  )
}

export default function ReportDetailPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()
  const id = parseId(useParams().reportId)
  const { data: report, isPending, isError, error, refetch } = useReport(id)
  const remove = useDeleteReport(id ?? 0)
  const { data: attachments } = useAttachments(id ?? 0)

  if (id === null || (error instanceof ApiError && error.status === 404)) return <ReportNotFound />
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

  return (
    <>
      <PageHeader
        title={report.title}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to={`/reports/${report.id}/edit`}>
                <Pencil aria-hidden="true" />
                {t('common.edit')}
              </Link>
            </Button>
            <ExportPdfButton sourceType="report" sourceId={report.id} />
            <ConfirmButton
              title={t('reports.deleteDialog.title')}
              body={t('reports.deleteDialog.body', { name: report.title, count: attachments?.length ?? 0 })}
              confirmLabel={t('reports.deleteDialog.confirm')}
              pending={remove.isPending}
              onConfirm={() =>
                remove.mutate(undefined, {
                  onSuccess: () => {
                    toast({ tone: 'success', message: t('reports.toast.deleted') })
                    navigate('/reports', { replace: true })
                  },
                  onError: (err) => toast({ tone: 'error', message: apiErrorMessage(t, err) }),
                })
              }
            >
              <Trash2 aria-hidden="true" />
              {t('common.delete')}
            </ConfirmButton>
          </div>
        }
      />
      <div className="-mt-4 mb-8 flex flex-wrap gap-2">
        <SeverityBadge severity={report.severity} />
        <ReportStatusBadge status={report.status} />
        <ReportTypeBadge type={report.type} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Section id="section-body" title={t('reports.detail.body')}>
            {report.body_md ? (
              <MarkdownView source={report.body_md} />
            ) : (
              <p className="text-muted-foreground text-sm">{t('reports.detail.noBody')}</p>
            )}
          </Section>
          <Section id="section-evidence" title={t('reports.detail.evidence')}>
            <EvidenceSection reportId={report.id} />
          </Section>
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Section id="section-status" title={t('reports.workflow.title')}>
            <StatusPanel report={report} />
          </Section>
          <Section id="section-facts" title={t('reports.detail.timeline')}>
            <Facts report={report} />
          </Section>
          <Section id="section-activity" title={t('reports.detail.activity')}>
            <ActivityList scope={{ entityType: 'report', entityId: report.id }} />
          </Section>
        </div>
      </div>
    </>
  )
}
