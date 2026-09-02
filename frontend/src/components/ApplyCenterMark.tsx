type ApplyCenterMarkProps = {
  className?: string
  /** 'gradient' tips the A's apex in the signal hue (default, on plain
   *  backgrounds). 'flat' renders the whole glyph in currentColor, for use
   *  inside a solid badge where a second colour would muddy it. */
  tone?: 'gradient' | 'flat'
}

/**
 * The ApplyCenter monogram: an A held inside an open C.
 *
 * The mark it replaces was a geometric Z with an arrowhead, drawn for a
 * product whose initial is not Z — it read as a stray glyph at nav size and
 * as noise at 16px. This is the product's own initials, which is the one
 * thing a monogram has to be.
 *
 * The C is drawn as a 276° arc with its opening on the right, and the A sits
 * inside it as a chevron with a crossbar. The opening matters: a closed ring
 * would make the A look trapped, and the gap gives the whole mark a direction,
 * which is the same forward/upward idea the old arrowhead was reaching for
 * without needing a second shape to say it.
 *
 * Geometry is on a 32-unit grid, computed rather than eyeballed. The arc
 * endpoints sit exactly on a radius-12 circle at ±42°; the crossbar's ends sit
 * exactly on the chevron's legs (t = 0.70 along each), so the three strokes
 * meet rather than approach. Everything is stroked in currentColor with round
 * joins, so it inherits ink and stays crisp from 16px up.
 */
export function ApplyCenterMark({ className = 'w-7 h-7', tone = 'gradient' }: ApplyCenterMarkProps) {
  const flat = tone === 'flat'

  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" fill="none">
      {/* The C. Opening on the right, centred on 0°, spanning 84°. */}
      <path
        d="M24.92 7.97 A12 12 0 1 0 24.92 24.03"
        stroke="currentColor"
        strokeWidth="3.3"
        strokeLinecap="round"
      />
      {/* The A: apex, two legs. */}
      <path
        d="M11 23.5 L16 7.1 L21 23.5"
        stroke="currentColor"
        strokeWidth="3.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Crossbar, its ends landing on the legs rather than near them. */}
      <path
        d="M12.49 18.6 H19.51"
        stroke={flat ? 'currentColor' : 'var(--color-signal)'}
        strokeWidth="3.3"
        strokeLinecap="round"
      />
    </svg>
  )
}
