'use client'

import { motion, useInView } from 'framer-motion'
import { useRef } from 'react'
import { cn } from '@/lib/utils'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'

/**
 * The product's signature motif: a conic-gradient (blue → violet → cyan) ring
 * that visualizes a 0-100 score. Reused for ATS score, interview score, and
 * the hero's animated dashboard mockup — one visual language for "your number."
 */
export function ScoreRing({
  value,
  size = 96,
  strokeWidth = 8,
  label,
  className,
}: {
  value: number
  size?: number
  strokeWidth?: number
  label?: string
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.6 })
  const reduceMotion = usePrefersReducedMotion()
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const target = reduceMotion || inView ? value : 0

  return (
    <div ref={ref} className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border)" strokeWidth={strokeWidth} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="url(#score-ring-gradient)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - target / 100) }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
        />
        <defs>
          <linearGradient id="score-ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--primary)" />
            <stop offset="55%" stopColor="var(--secondary)" />
            <stop offset="100%" stopColor="var(--accent)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display font-bold tabular-nums text-foreground" style={{ fontSize: size * 0.26 }}>
          {Math.round(target)}
        </span>
        {label && <span className="text-[10px] uppercase tracking-wide text-muted">{label}</span>}
      </div>
    </div>
  )
}
