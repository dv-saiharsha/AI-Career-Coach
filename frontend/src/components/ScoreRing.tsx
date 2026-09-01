'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { bandColor, bandForScore, bandLabel, type ScoreBand } from '@/lib/scoreBands'

export interface ScoreRingProps {
  /** 0–100. */
  value: number
  size?: number
  strokeWidth?: number
  label?: string
  className?: string
  /** Soft pulse behind the ring while a score is being computed. */
  pending?: boolean
  /**
   * Supply this when the caller already has an authoritative band for the
   * value (e.g. the analyzer's API response) — the ring then reflects that
   * exact band rather than re-deriving one, so the same score can never read
   * two different ways in two different places.
   */
  band?: ScoreBand
}

/**
 * SVG gauge for ATS and interview scores.
 *
 * The arc fills from zero over 900ms the first time it paints, then holds.
 * The numeral does not count up with it: the number is the information, and
 * making someone wait 900ms to read their own score is animation for its own
 * sake. It is also what let the whole Framer spring, motion value and
 * per-frame setState go — this is now two CSS transitions and no JS
 * animation loop at all.
 *
 * The track is an inset groove and the arc sits in it, the same relationship
 * as a progress bar.
 */
export function ScoreRing({
  value,
  size = 132,
  strokeWidth = 10,
  label,
  className,
  pending = false,
  band,
}: ScoreRingProps) {
  const clamped = Math.min(100, Math.max(0, Math.round(value)))
  const resolvedBand = band ?? bandForScore(clamped)
  const color = bandColor(resolvedBand)
  const caption = bandLabel(resolvedBand)

  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  /* Paint empty, then transition to the real offset on the next frame.
     Two frames rather than one: a single rAF sometimes coalesces with the
     initial paint and the arc appears already full. */
  const [filled, setFilled] = React.useState(false)
  React.useEffect(() => {
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setFilled(true))
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [])

  const offset = filled ? circumference * (1 - clamped / 100) : circumference

  return (
    <div className={cn('relative inline-flex flex-col items-center gap-2.5', className)}>
      <div className="relative" style={{ width: size, height: size }}>
        {pending && (
          <span
            aria-hidden="true"
            className="absolute inset-0 animate-breathe rounded-full motion-reduce:animate-none"
            style={{ background: `radial-gradient(circle, ${color}22 0%, transparent 68%)` }}
          />
        )}

        {/* The well the arc sits in. */}
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-canvas neu-inset"
        />

        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="relative -rotate-90"
          role="img"
          aria-label={`${label ? `${label}: ` : ''}${clamped} out of 100. ${caption}.`}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--line)"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            /* Inline rather than a utility because the dash offset itself is
               computed. Reduced motion is still honoured: the global
               prefers-reduced-motion block in globals.css collapses every
               transition-duration with !important, which an inline style
               cannot outrank. */
            style={{
              transition: 'stroke-dashoffset 900ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="font-mono font-semibold tabular-nums leading-none tracking-[-0.045em] text-ink"
            style={{ fontSize: size * 0.28 }}
          >
            {clamped}
          </span>
          {label && <span className="mt-1.5 text-micro text-ink-faint">{label}</span>}
        </div>
      </div>

      <span className="text-[13px] font-medium" style={{ color }}>
        {caption}
      </span>
    </div>
  )
}

export default ScoreRing
