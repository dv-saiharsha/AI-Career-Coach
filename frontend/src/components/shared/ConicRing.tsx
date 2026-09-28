import { cn } from '@/lib/utils'

interface ConicRingProps {
  value: number // 0-100
  size: number // px
  toneClassName?: string // Tailwind text-color class driving the ring's stroke
  /** Background of the center "hole" — must match whatever the ring actually
   *  sits on. Defaults to the card surface (right for the many usages that
   *  sit on a white/card background); override for a colored or dark hero
   *  banner, or the center content (typically white text) becomes invisible
   *  against the default white hole. */
  holeClassName?: string
  children?: React.ReactNode
}

// Figma's flat conic-gradient ring (`.score-ring` / `.mini-ring` in
// figma-export/src/index.css) — a solid arc, not an SVG stroke, so this is a
// separate primitive from components/shared/ScoreRing.tsx (used elsewhere).
export function ConicRing({ value, size, toneClassName, holeClassName = 'bg-card', children }: ConicRingProps) {
  const clamped = Math.min(100, Math.max(0, value))
  return (
    <div
      className={cn('relative grid shrink-0 place-items-center rounded-full', toneClassName)}
      style={{
        width: size,
        height: size,
        background: `conic-gradient(currentColor ${clamped}%, hsl(var(--border)) 0)`,
      }}
    >
      <div className={cn('absolute rounded-full', holeClassName)} style={{ inset: Math.max(3, size * 0.07) }} />
      <div className="relative">{children}</div>
    </div>
  )
}
