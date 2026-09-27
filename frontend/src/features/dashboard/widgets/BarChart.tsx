import { Bar, BarChart as RBarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { formatCompact } from '@/shared/lib/format'

export interface BarDatum {
  label: string
  value: number
  /** Tooltip text for the value, e.g. "$1,200.00" (defaults to the number). */
  display?: string
}

interface Props {
  data: BarDatum[]
  /** One-sentence summary for screen readers (the table under the chart has the rest). */
  summary: string
  orientation?: 'horizontal' | 'vertical'
  height?: number
}

const AXIS = { fill: 'var(--muted-foreground)', fontSize: 11 }

function TooltipBox({ active, payload }: { active?: boolean; payload?: { payload: BarDatum }[] }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-popover text-popover-foreground rounded-md border px-2.5 py-1.5 text-xs shadow-md">
      <div className="text-muted-foreground">{d.label}</div>
      <div className="font-medium tabular-nums">{d.display ?? d.value.toLocaleString()}</div>
    </div>
  )
}

/**
 * A single-series bar chart (dataviz rules): one accent hue, bars ≤ 24 px with a
 * 4 px rounded data end, hairline grid, no legend (the card title names the series),
 * text in text colours, a hover tooltip. role="img" + summary; the data table sits beside it.
 */
export function BarChart({ data, summary, orientation = 'vertical', height = 220 }: Props) {
  const horizontal = orientation === 'horizontal'
  return (
    <div role="img" aria-label={summary} className="w-full min-w-0" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RBarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 4, right: 12, bottom: 0, left: horizontal ? 8 : -8 }} barCategoryGap={4}>
          <CartesianGrid stroke="var(--border)" strokeWidth={1} horizontal={!horizontal} vertical={horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" allowDecimals={false} tick={AXIS} tickFormatter={formatCompact} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="label" width={96} tick={AXIS} axisLine={false} tickLine={false} />
            </>
          ) : (
            <>
              <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={8} />
              <YAxis allowDecimals={false} tick={AXIS} tickFormatter={formatCompact} axisLine={false} tickLine={false} width={60} />
            </>
          )}
          <Tooltip content={<TooltipBox />} cursor={{ fill: 'var(--muted)' }} isAnimationActive={false} />
          <Bar
            dataKey="value"
            fill="var(--primary)"
            maxBarSize={24}
            radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </RBarChart>
      </ResponsiveContainer>
    </div>
  )
}
