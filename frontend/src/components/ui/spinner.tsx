import { cn } from '@/lib/utils'

/**
 * Indeterminate work only — parsing a file, waiting on a model. Anything
 * content-shaped uses <Skeleton> instead, which tells the user what is
 * coming rather than only that something is.
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
        className={cn('size-4 animate-spin text-accent-text motion-reduce:animate-none', className)}
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  )
}
