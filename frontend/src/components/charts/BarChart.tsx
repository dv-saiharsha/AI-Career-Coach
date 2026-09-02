import { cn } from '@/lib/utils'

export interface Bar {
  label: string
  value: number
  /** Optional token colour. Defaults to the accent. */
  color?: string
}

export interface BarChartProps {
  bars: readonly Bar[]
  summary: string
  className?: string
}

/**
 * Horizontal bars, drawn as divs rather than SVG — at this size a bar is a
 * rounded rectangle, and a div is one less coordinate system to reason about.
 *
 * Each track is an inset groove and each fill sits in it, the same
 * relationship as <Progress>. Values are printed beside the bars, so the
 * comparison never depends on judging two lengths by eye.
 */
export function BarChart({ bars, summary, className }: BarChartProps) {
  const max = Math.max(...bars.map((b) => b.value), 1)

  return (
    <figure className={cn('w-full', className)}>
      <ul className="flex flex-col gap-3" aria-hidden="true">
        {bars.map((bar) => (
          <li key={bar.label} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5">
            <span className="text-micro text-ink-dim">{bar.label}</span>
            <span className="text-micro font-medium text-ink">{bar.value}</span>
            <div className="col-span-2 h-2 rounded-full bg-canvas field-ring-soft">
              <div
                className="h-full rounded-full"
                style={{
                  width: Math.max(4, (bar.value / max) * 100) + '%',
                  background: bar.color ?? 'var(--gradient-accent)',
                }}
              />
            </div>
          </li>
        ))}
      </ul>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  )
}
