import { TrendChart } from '@/components/charts/TrendChart'

/**
 * The dashboard's ATS trend.
 *
 * This was a Recharts chart, dynamically imported from dashboard/page.tsx
 * specifically because Recharts was the largest chunk in the build and this
 * sits below the fold on every viewport. Hand-authored SVG removes both the
 * chunk and the reason to defer it — the chart is now server-rendered markup
 * that arrives with the rest of the page.
 *
 * It also stops needing useAccentPalette and useChartTheme. Those existed to
 * read CSS custom properties out into JavaScript, because Recharts takes
 * colours as props and cannot resolve `var(--accent)` itself. SVG can, so the
 * chart follows a theme switch directly instead of re-reading the computed
 * style on every change.
 */
export interface TrendPoint {
  label: string
  date: string
  score: number
}

export default function ResumeTrendChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) return null

  const first = data[0]
  const last = data[data.length - 1]
  const direction =
    data.length < 2
      ? 'a single scan so far'
      : last.score > first.score
        ? `up ${Math.round(last.score - first.score)} points`
        : last.score < first.score
          ? `down ${Math.round(first.score - last.score)} points`
          : 'unchanged'

  return (
    <div className="-ml-2">
      <TrendChart
        id="dashboard-ats-trend"
        points={data}
        fixedScale
        height={240}
        summary={`ATS score across ${data.length} scans, from ${first.score} on ${first.label} to ${last.score} on ${last.label} — ${direction}.`}
      />
    </div>
  )
}
