type ZenithMarkProps = {
  className?: string
  /** 'gradient' renders the two-tone accent peak (default, for use on plain backgrounds).
   *  'flat' renders a single-color glyph via currentColor (for use inside a solid badge). */
  tone?: 'gradient' | 'flat'
}

/**
 * The Zenith logomark: an ascending peak reaching a single point of light —
 * the summit of a career climb, and the literal zenith (the sky's highest point).
 */
export function ZenithMark({ className = 'w-7 h-7', tone = 'gradient' }: ZenithMarkProps) {
  const flat = tone === 'flat'
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path
        d="M16 9 L5 27 L16 27 Z"
        fill={flat ? 'currentColor' : 'var(--color-accent-dim)'}
        opacity={flat ? 0.7 : 1}
      />
      <path
        d="M16 9 L27 27 L16 27 Z"
        fill={flat ? 'currentColor' : 'var(--color-accent-light)'}
      />
      <circle
        cx="16"
        cy="4.5"
        r="2.4"
        fill={flat ? 'currentColor' : 'var(--color-accent-lighter)'}
      />
    </svg>
  )
}
