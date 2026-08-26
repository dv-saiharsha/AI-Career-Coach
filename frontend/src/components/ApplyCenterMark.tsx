type ApplyCenterMarkProps = {
  className?: string
  /** 'gradient' tips the arrowhead in the warm accent (default, on plain
   *  backgrounds). 'flat' renders the whole glyph in currentColor, for use
   *  inside a solid badge where a second colour would muddy it. */
  tone?: 'gradient' | 'flat'
}

/**
 * The ApplyCenter logomark: a geometric Z whose diagonal carries on past the letter
 * and resolves into an ascending arrow — the letterform and the idea of upward
 * career motion in a single stroke.
 *
 * Redrawn as flat vector from the supplied brand render. That source file is a
 * presentation mockup — brushed-metal bevels, drop shadow, and a baked-in cream
 * background — none of which survives a 20px navbar or a favicon, and none of
 * which can sit on the obsidian canvas. Geometry only here, on a 32-unit grid,
 * so it stays crisp from 16px up and inherits ink/cream through currentColor.
 *
 * Geometry notes: the shaft and the arrowhead share one axis (unit vector
 * ≈ 0.562, -0.827) and the head's base sits exactly on the shaft's end point,
 * so the two read as one object rather than a triangle floating near a line.
 * Butt caps + a tight miter limit keep the acute bottom-left corner from
 * throwing a spike past the baseline.
 */
export function ApplyCenterMark({ className = 'w-7 h-7', tone = 'gradient' }: ApplyCenterMarkProps) {
  const flat = tone === 'flat'

  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" fill="none">
      {/* Shaft → diagonal → bottom bar, drawn as one continuous stroke. */}
      <path
        d="M22.31 6.87 L11 23.5 H24"
        stroke="currentColor"
        strokeWidth="3.4"
        strokeLinecap="butt"
        strokeLinejoin="miter"
        strokeMiterlimit="2"
      />
      {/* Top bar. Overlaps the diagonal at x≈19.5 so the corner fills solid. */}
      <path
        d="M7 11 H20"
        stroke="currentColor"
        strokeWidth="3.4"
        strokeLinecap="butt"
      />
      {/* Arrowhead. Base centre is the shaft's end point; tip runs on the axis. */}
      <path
        d="M25.01 2.90 L25.12 8.78 L19.50 4.96 Z"
        fill={flat ? 'currentColor' : 'var(--color-data-3)'}
      />
    </svg>
  )
}
