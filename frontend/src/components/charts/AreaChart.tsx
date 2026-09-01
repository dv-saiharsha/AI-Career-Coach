import { cn } from '@/lib/utils'

export interface AreaChartProps {
  /** One value per period, oldest first. */
  data: readonly number[]
  labels?: readonly string[]
  /** Read out to screen readers in place of the drawing. */
  summary: string
  className?: string
  height?: number
  /** Unique within the page — SVG gradient ids are global. */
  id: string
}

/**
 * Hand-authored SVG area chart.
 *
 * There is no charting library here on purpose. Recharts is around 90KB
 * gzipped and renders through React on the client; this is a path string
 * computed once on the server and shipped as markup, which costs nothing at
 * runtime and paints with the rest of the HTML.
 *
 * The drawing is aria-hidden and `summary` carries the same information as
 * text, because a chart nobody can see is not information.
 */
export function AreaChart({ data, labels, summary, className, height = 132, id }: AreaChartProps) {
  const width = 320
  const pad = 6
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const span = max - min || 1

  const x = (i: number) => pad + (i / Math.max(1, data.length - 1)) * (width - pad * 2)
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2)

  /* Control points sit a third of the way toward each neighbour, which keeps
     the curve from overshooting past a local maximum the way a naive
     quadratic through the midpoints does. */
  const line = data
    .map((v, i) => {
      if (i === 0) return 'M ' + x(0) + ' ' + y(v)
      const prev = data[i - 1]
      const cx1 = x(i - 1) + (x(i) - x(i - 1)) / 3
      const cx2 = x(i) - (x(i) - x(i - 1)) / 3
      return 'C ' + cx1 + ' ' + y(prev) + ', ' + cx2 + ' ' + y(v) + ', ' + x(i) + ' ' + y(v)
    })
    .join(' ')

  const fill = line + ' L ' + x(data.length - 1) + ' ' + height + ' L ' + x(0) + ' ' + height + ' Z'

  return (
    <figure className={cn('w-full', className)}>
      <svg viewBox={'0 0 ' + width + ' ' + height} className="h-auto w-full" aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.34" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Hairlines are allowed inside a chart — one of the two places in
            this system where a line is not a mistake. */}
        {[0.25, 0.5, 0.75].map((t) => (
          <line
            key={t}
            x1={pad}
            x2={width - pad}
            y1={pad + t * (height - pad * 2)}
            y2={pad + t * (height - pad * 2)}
            stroke="var(--line)"
            strokeWidth="1"
          />
        ))}

        <path d={fill} fill={'url(#' + id + ')'} />
        <path
          d={line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={x(data.length - 1)} cy={y(data[data.length - 1])} r="4" fill="var(--accent)" />
      </svg>

      {labels && (
        <div className="mt-2 flex justify-between px-1.5" aria-hidden="true">
          {labels.map((l) => (
            <span key={l} className="text-micro text-ink-faint">
              {l}
            </span>
          ))}
        </div>
      )}

      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  )
}
