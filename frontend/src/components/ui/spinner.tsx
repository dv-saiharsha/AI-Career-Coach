import { cn } from '@/lib/utils'

/**
 * Indeterminate progress. A thin rotating arc rather than a filled ring —
 * it reads as a hairline against cream at small sizes.
 */
export function Spinner({
  className,
  label = 'Loading',
}: {
  className?: string
  label?: string
}) {
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className={cn('size-4 animate-spin text-ink-dim', className)}
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.18" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  )
}
