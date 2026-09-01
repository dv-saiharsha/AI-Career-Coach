'use client'

import AnimatedNumber from './AnimatedNumber'
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion'
import { Reveal } from '@/lib/reveal'
import { cn } from '@/lib/utils'

const BAR_COUNT = 28
const MAX_HEIGHT = 72

function verdictFor(score: number): { label: string; color: string } {
  if (score >= 75) return { label: 'STRONG MATCH', color: 'var(--color-signal-high)' }
  if (score >= 45) return { label: 'PARTIAL MATCH', color: 'var(--color-signal-mid)' }
  return { label: 'NEEDS WORK', color: 'var(--color-signal-low)' }
}

/** Deterministic pseudo-random in [0, 1), seeded so the same score always
 * renders the same waveform shape. */
function seeded(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

function barHeights(score: number): number[] {
  const amplitude = 0.22 + (score / 100) * 0.78
  return Array.from({ length: BAR_COUNT }, (_, i) => {
    const p = i / (BAR_COUNT - 1)
    const envelope = Math.sin(p * Math.PI) // taller in the middle, tapering at the edges
    const jitter = 0.55 + seeded(i * 7.31 + score) * 0.45 // organic per-bar variance
    return Math.max(0.06, envelope * jitter * amplitude)
  })
}

/**
 * The Waveform — the one theatrical moment in the product. A signal-strength
 * visualization settles in beside the score as it's decoded, purely
 * atmospheric: the score itself is always carried by the numeral and the
 * verdict tag, never by the bars alone.
 */
export default function Waveform({ score, subtitle }: { score: number; subtitle?: string }) {
  const reduce = usePrefersReducedMotion()
  const clamped = Math.min(100, Math.max(0, Math.round(score)))
  const { label, color } = verdictFor(clamped)
  const heights = barHeights(clamped)

  return (
    <div
      className="rounded-[18px] px-8 py-10 md:px-10 md:py-12 bg-[var(--color-canvas-elevated)] border border-[var(--color-canvas-line)]"
      style={{ boxShadow: 'var(--glow-signal)' }}
      role="group"
      aria-label={`ATS match score: ${clamped} out of 100, ${label.toLowerCase()}`}
    >
      <div className="flex flex-col sm:flex-row items-center sm:items-end gap-8">
        <div className="flex items-end gap-1 h-[72px] shrink-0" aria-hidden="true">
          {/* Each bar grows from 2px to its own height. The stagger is a
              per-bar transition-delay rather than a delay prop, because 28
              bars is well past the shared observer's six-child stagger cap —
              this is one gesture, not a list arriving. */}
          {heights.map((h, i) => (
            <div
              key={i}
              className={cn(
                'w-[3px] rounded-full',
                !reduce &&
                  'motion-safe:transition-[height] motion-safe:duration-600 motion-safe:ease-(--ease-enter)',
              )}
              style={{
                background: color,
                height: h * MAX_HEIGHT,
                transitionDelay: reduce ? undefined : `${i * 15}ms`,
              }}
            />
          ))}
        </div>

        <div className="flex flex-col items-center sm:items-start gap-3">
          <div className="flex items-baseline gap-2">
            <span className="font-display italic font-medium text-[56px] md:text-[64px] leading-none text-[var(--color-ink)]">
              <AnimatedNumber value={clamped} duration={1200} />
            </span>
            <span className="text-sm font-mono text-[var(--color-ink-faint)]">/ 100</span>
          </div>
          <Reveal
            as="span"
            delay={reduce ? 0 : 1100}
            className="eyebrow px-3 py-1.5 rounded-full border"
            style={{ color, borderColor: color }}
          >
            {label}
          </Reveal>
        </div>
      </div>

      {subtitle && (
        <p className="text-sm text-[var(--color-ink-dim)] mt-6 max-w-lg">{subtitle}</p>
      )}
    </div>
  )
}
