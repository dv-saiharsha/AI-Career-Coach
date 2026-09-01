import { cn } from '@/lib/utils'

export interface TrendPoint {
  /** Short axis label, e.g. "4 Mar". */
  date: string
  score: number
  /** Longer form for the tooltip and the data table, e.g. "4 March 2026". */
  label?: string
}

export interface TrendChartProps {
  points: readonly TrendPoint[]
  /** Read out in place of the drawing, and printed if the SVG fails to paint. */
  summary: string
  /** Appended to each value in the tooltip and table, e.g. "%" or " ATS". */
  unit?: string
  /** Fixed 0–100 axis for scores; otherwise the range fits the data. */
  fixedScale?: boolean
  height?: number
  className?: string
  /** Unique within the page — SVG gradient and clip ids are global. */
  id: string
}

/* Geist Mono at 11px. Deterministic enough to size a tooltip pill on the
   server, which is what keeps this a server component — measuring text in
   the browser would mean shipping JavaScript for a label. */
const MONO_CH = 6.25

/**
 * Score over time: area, line, points, and a tooltip on hover or focus.
 *
 * Replaces three separate Recharts trend charts that were each configured
 * slightly differently. Recharts is about 90KB gzipped and renders through
 * React on the client; this is a path string computed on the server and
 * shipped as markup, so the chart is in the first paint rather than after a
 * hydration round trip.
 *
 * The tooltip is CSS, not state. Each point has a transparent hit target, and
 * `:hover`/`:focus-visible` on it reveals the guide line and the pill through
 * a sibling selector — so this component ships no JavaScript at all while
 * still being reachable by keyboard.
 *
 * Below the drawing sits a visually hidden table of the same numbers. A chart
 * is a convenience for people who can see it; the table is the actual data.
 */
export function TrendChart({
  points,
  summary,
  unit = '',
  fixedScale = false,
  height = 200,
  className,
  id,
}: TrendChartProps) {
  if (points.length === 0) return null

  const width = 640
  const padX = 34
  const padTop = 22
  const padBottom = 26

  const values = points.map((p) => p.score)
  const max = fixedScale ? 100 : Math.max(...values) * 1.08
  const min = fixedScale ? 0 : Math.min(...values, 0) * 0.95
  const span = max - min || 1

  const x = (i: number) => padX + (i / Math.max(1, points.length - 1)) * (width - padX * 2)
  const y = (v: number) => padTop + (1 - (v - min) / span) * (height - padTop - padBottom)

  /* Control points a third of the way toward each neighbour. A naive
     quadratic through the midpoints overshoots past a local maximum, which on
     a score chart draws a peak the user never actually reached. */
  const line = points
    .map((p, i) => {
      if (i === 0) return `M ${x(0)} ${y(p.score)}`
      const prev = points[i - 1].score
      const cx1 = x(i - 1) + (x(i) - x(i - 1)) / 3
      const cx2 = x(i) - (x(i) - x(i - 1)) / 3
      return `C ${cx1} ${y(prev)}, ${cx2} ${y(p.score)}, ${x(i)} ${y(p.score)}`
    })
    .join(' ')

  const baseline = height - padBottom
  const area = `${line} L ${x(points.length - 1)} ${baseline} L ${x(0)} ${baseline} Z`

  const gridLines = fixedScale ? [0, 25, 50, 75, 100] : [min, min + span / 2, max]

  /* Every other label once there are more than eight points — at 640px wide
     they collide before that. */
  const labelStep = points.length > 8 ? Math.ceil(points.length / 6) : 1

  /* Keyed by index throughout, not by date. Two scans on the same day are
     ordinary — a user uploads, fixes something, uploads again — and every
     date-keyed element then collides, which React reports as duplicate keys
     and resolves by dropping one of the points. Index is the correct
     identity here: the series is positional, nothing reorders or is inserted
     mid-array, and none of these elements holds state. */
  return (
    <figure className={cn('w-full', className)}>
      <style>{`
        #${id} .pt-hit { fill: transparent; cursor: pointer; outline: none; }
        #${id} .pt-reveal { opacity: 0; transition: opacity .12s ease-out; }
        #${id} .pt-hit:hover + .pt-reveal,
        #${id} .pt-hit:focus-visible + .pt-reveal { opacity: 1; }
        #${id} .pt-hit:focus-visible + .pt-reveal .pt-dot { stroke: var(--ink); stroke-width: 2; }
        @media (prefers-reduced-motion: reduce) {
          #${id} .pt-reveal { transition: none; }
        }
      `}</style>

      <svg
        id={id}
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full overflow-visible"
        role="img"
        aria-label={summary}
      >
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Hairlines are allowed inside a chart — one of the two places in
            this system where a line is not a mistake. */}
        {gridLines.map((v, gi) => (
          <g key={gi}>
            <line
              x1={padX}
              x2={width - padX}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--line)"
              strokeWidth="1"
            />
            {fixedScale && (
              <text
                x={padX - 8}
                y={y(v) + 3.5}
                textAnchor="end"
                fontSize="10"
                fill="var(--ink-faint)"
                fontFamily="var(--font-mono)"
              >
                {v}
              </text>
            )}
          </g>
        ))}

        <path d={area} fill={`url(#${id}-fill)`} />
        <path
          d={line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.score)} r="3" fill="var(--accent)" />
        ))}

        {points.map((p, i) =>
          i % labelStep === 0 || i === points.length - 1 ? (
            <text
              key={i}
              x={x(i)}
              y={height - 7}
              textAnchor="middle"
              fontSize="10"
              fill="var(--ink-faint)"
              fontFamily="var(--font-mono)"
            >
              {p.date}
            </text>
          ) : null,
        )}

        {points.map((p, i) => {
          const text = `${p.score}${unit}`
          const pillW = Math.max(34, text.length * MONO_CH + 18)
          const pillX = Math.min(Math.max(x(i) - pillW / 2, 2), width - pillW - 2)
          const pillY = Math.max(y(p.score) - 34, 2)
          const band = (width - padX * 2) / Math.max(1, points.length - 1)

          return (
            <g key={i}>
              <rect
                className="pt-hit"
                x={x(i) - band / 2}
                y={0}
                width={band}
                height={height}
                tabIndex={0}
                role="img"
                aria-label={`${p.label ?? p.date}: ${p.score}${unit}`}
              />
              <g className="pt-reveal" aria-hidden="true">
                <line
                  x1={x(i)}
                  x2={x(i)}
                  y1={padTop - 6}
                  y2={baseline}
                  stroke="var(--line-strong)"
                  strokeWidth="1"
                />
                <circle
                  className="pt-dot"
                  cx={x(i)}
                  cy={y(p.score)}
                  r="5"
                  fill="var(--accent)"
                />
                <rect
                  x={pillX}
                  y={pillY}
                  width={pillW}
                  height={22}
                  rx="8"
                  fill="var(--canvas-elevated)"
                />
                <text
                  x={pillX + pillW / 2}
                  y={pillY + 15}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="500"
                  fill="var(--ink)"
                  fontFamily="var(--font-mono)"
                >
                  {text}
                </text>
              </g>
            </g>
          )
        })}
      </svg>

      <figcaption className="sr-only">
        {summary}
        <table>
          <caption>{summary}</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Score</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p, i) => (
              <tr key={i}>
                <th scope="row">{p.label ?? p.date}</th>
                <td>
                  {p.score}
                  {unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  )
}
