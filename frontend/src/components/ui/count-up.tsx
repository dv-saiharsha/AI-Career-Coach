import { cn } from '@/lib/utils'

/**
 * A number that counts up to its value, in CSS.
 *
 * This replaces react-countup, which ran a rAF loop per instance to animate
 * text. A registered custom property can be animated by the compositor and
 * read back through counter(), so the whole effect is one keyframe and no
 * JavaScript — and it is a server component, so the routes using it ship
 * nothing at all for the behaviour.
 *
 * The real value is always in the DOM as text for assistive technology; the
 * animated copy is aria-hidden. A screen reader should hear "84", not a
 * number climbing, and a reader who has not enabled animation should see the
 * final value immediately — both are handled without a second code path,
 * because the fallback IS the accessible copy.
 */
export function CountUp({
  value,
  suffix,
  prefix,
  decimals = 0,
  className,
}: {
  value: number
  suffix?: string
  prefix?: string
  /** Rendered statically — counter() is integer-only. */
  decimals?: number
  className?: string
}) {
  const label = `${prefix ?? ''}${value.toFixed(decimals)}${suffix ?? ''}`

  // A fractional value has nothing to count: render it and stop.
  if (decimals > 0 || !Number.isFinite(value)) {
    return <span className={className}>{label}</span>
  }

  return (
    <span className={cn('tabular-nums', className)}>
      <span className="sr-only">{label}</span>
      <span aria-hidden="true">
        {prefix}
        <span
          className="count-up"
          style={{ '--count-target': Math.round(value) } as React.CSSProperties}
        />
        {suffix}
      </span>
    </span>
  )
}
