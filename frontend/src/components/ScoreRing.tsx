'use client'

import * as React from 'react'
import { motion, useReducedMotion, useSpring, useTransform } from 'framer-motion'
import { cn } from '@/lib/utils'

export interface ScoreRingProps {
  /** 0–100. */
  value: number
  size?: number
  strokeWidth?: number
  label?: string
  className?: string
  /** Soft pulse behind the ring while a score is being computed. */
  pending?: boolean
}

/* Bands are declared as tokens, not raw hex, so they re-theme with the page.
   The band also drives the caption, so the reading never depends on colour
   alone — a colour-blind user gets the same information from the word. */
function band(value: number) {
  if (value >= 80) return { color: 'var(--success)', caption: 'Strong' }
  if (value >= 60) return { color: 'var(--data-3)', caption: 'Competitive' }
  if (value >= 40) return { color: 'var(--warning)', caption: 'Needs work' }
  return { color: 'var(--danger)', caption: 'At risk' }
}

/**
 * Animated SVG gauge for ATS and interview scores.
 *
 * The arc is drawn with strokeDashoffset driven by a spring, and the numeral
 * counts up off the same spring — so ring and number always agree, even if
 * the value changes mid-flight.
 */
export function ScoreRing({
  value,
  size = 132,
  strokeWidth = 8,
  label,
  className,
  pending = false,
}: ScoreRingProps) {
  const reduce = useReducedMotion()
  const clamped = Math.min(100, Math.max(0, value))
  const { color, caption } = band(clamped)

  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  const progress = useSpring(reduce ? clamped : 0, {
    stiffness: 90,
    damping: 22,
    mass: 1,
  })

  React.useEffect(() => {
    progress.set(clamped)
  }, [clamped, progress])

  const dashOffset = useTransform(progress, (p) => circumference * (1 - p / 100))
  const [display, setDisplay] = React.useState(reduce ? clamped : 0)

  React.useEffect(() => {
    const unsub = progress.on('change', (p) => setDisplay(Math.round(p)))
    return () => unsub()
  }, [progress])

  return (
    <div className={cn('relative inline-flex flex-col items-center gap-2', className)}>
      <div className="relative" style={{ width: size, height: size }}>
        {pending && (
          <span
            aria-hidden="true"
            className="absolute inset-0 animate-breathe rounded-full"
            style={{ background: `radial-gradient(circle, ${color}22 0%, transparent 68%)` }}
          />
        )}

        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
          role="img"
          aria-label={`${label ? `${label}: ` : ''}${clamped} out of 100 — ${caption}`}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--canvas-elevated)"
            strokeWidth={strokeWidth}
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            style={{ strokeDashoffset: dashOffset }}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="font-display tabular-nums leading-none tracking-[-0.03em] text-ink"
            style={{ fontSize: size * 0.3 }}
          >
            {display}
          </span>
          {label && (
            <span className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
              {label}
            </span>
          )}
        </div>
      </div>

      <span className="text-[13px] font-medium" style={{ color }}>
        {caption}
      </span>
    </div>
  )
}

export default ScoreRing
