import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useSession } from '@/features/auth'
import { PageHeader } from '@/shared/layout/PageHeader'
import { Label } from '@/shared/ui/label'
import { NativeSelect } from '@/shared/ui/native-select'

import { lastMonths } from './api'
import { ActivityWidget, BountiesWidget, SeverityWidget, StatusWidget, SummaryTiles, TimelineWidget } from './widgets/Widgets'

const RANGES = [3, 6, 12, 24] as const
const RANGE_KEY = 'hexops.dashboardMonths'

function loadRange(): number {
  try {
    const n = Number(localStorage.getItem(RANGE_KEY))
    return (RANGES as readonly number[]).includes(n) ? n : 12
  } catch {
    return 12
  }
}

/** Read-only overview. Every number comes from current data (D-77); nothing is stored. */
export default function DashboardPage() {
  const { t } = useTranslation()
  const { data: session } = useSession()
  const [months, setMonths] = useState(loadRange)
  const range = lastMonths(months)

  return (
    <>
      <PageHeader
        title={t('dashboard.welcome', { name: session?.user.username ?? '' })}
        description={t('modules.dashboard')}
        actions={
          <div className="grid gap-1.5">
            <Label htmlFor="dashboard-range">{t('dashboard.range')}</Label>
            <NativeSelect
              id="dashboard-range"
              className="w-auto"
              value={months}
              onChange={(e) => {
                const n = Number(e.target.value)
                setMonths(n)
                try {
                  localStorage.setItem(RANGE_KEY, String(n))
                } catch {
                  // Non-fatal.
                }
              }}
            >
              {RANGES.map((n) => (
                <option key={n} value={n}>
                  {t('dashboard.lastMonths', { count: n })}
                </option>
              ))}
            </NativeSelect>
          </div>
        }
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="grid min-w-0 grid-cols-1 gap-4 md:col-span-2 md:grid-cols-2">
          <SummaryTiles />
          <SeverityWidget />
          <StatusWidget />
          <TimelineWidget range={range} />
          <BountiesWidget range={range} />
        </div>
        <div className="min-w-0 md:col-span-2 xl:col-span-1">
          <ActivityWidget />
        </div>
      </div>
    </>
  )
}
