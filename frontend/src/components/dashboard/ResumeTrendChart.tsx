'use client'

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useAccentPalette, useChartTheme } from '@/lib/useAccentPalette'

/**
 * The dashboard's ATS trend, split out of dashboard/page.tsx so it can be
 * lazily loaded — recharts is a ~360KB chunk and this chart sits at the very
 * bottom of the page, below the fold on every viewport.
 *
 * Extracting it also fixed the colours. Inline in the page it drew its grid,
 * tooltip cursor and active-dot ring from hardcoded hexes (#1e1e1e, #262626,
 * #0A0A0A) — dark-theme values baked in, so on porcelain the gridlines were
 * near-black instead of the faint canvas line the other charts use. Analytics
 * and History already read useChartTheme; this now does too.
 */
export interface TrendPoint {
  label: string
  date: string
  score: number
}

interface ChartTooltipProps {
  active?: boolean
  payload?: readonly { dataKey?: string; name?: string; value?: number; color?: string }[]
  label?: string
}

function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="min-w-35 rounded-xl border border-(--color-canvas-line) bg-(--color-canvas-raise) px-3.5 py-2.5 shadow-(--shadow-pop)">
      <div className="mb-2 text-[11px] font-medium text-(--color-ink-faint)">{label}</div>
      <div className="space-y-1.5">
        {payload.map((p) => (
          <div key={p.dataKey} className="flex items-center gap-2 text-xs">
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: p.color }}
              aria-hidden="true"
            />
            <span className="text-(--color-ink-dim)">{p.name}</span>
            <span className="ml-auto font-semibold tabular-nums text-(--color-ink)">{p.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ResumeTrendChart({ data }: { data: TrendPoint[] }) {
  const palette = useAccentPalette()
  const chart = useChartTheme()

  return (
    <div className="-ml-2 h-64 md:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="atsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={palette.accent} stopOpacity={0.35} />
              <stop offset="100%" stopColor={palette.accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={chart.grid} strokeDasharray="3 5" />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            tick={{ fill: chart.axis, fontSize: 11 }}
            dy={8}
          />
          <YAxis hide domain={[0, 100]} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: chart.grid, strokeWidth: 1 }} />
          <Area
            type="monotone"
            dataKey="score"
            name="ATS Score"
            stroke={palette.accent}
            strokeWidth={2.5}
            fill="url(#atsFill)"
            activeDot={{ r: 4, fill: palette.accent, stroke: chart.surface, strokeWidth: 2 }}
            animationDuration={900}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
