import { AlertCircle } from 'lucide-react'

/**
 * The icon + message content shared by every inline error banner in the app.
 * Deliberately just the content, not a wrapper with its own entrance
 * animation — call sites animate it differently (one with AnimatePresence +
 * height, one with a plain fade), and forcing one treatment on both would be
 * a visual change disguised as a refactor.
 *
 * `onRetry` is optional: most fetch-failure banners across the app have a
 * `refetch()` sitting right next to them already and previously had no way
 * to expose it, leaving "try again" as copy with nothing behind it. Passing
 * `onRetry` renders a real button; omitting it keeps the original bare
 * icon+message banner for validation-style errors that aren't retryable.
 */
export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 text-sm text-(--color-error) border-l-[3px] border-(--color-error) pl-3 py-1"
    >
      <AlertCircle strokeWidth={1.5} className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 font-medium text-(--color-error) underline underline-offset-2 hover:no-underline"
        >
          Retry
        </button>
      )}
    </div>
  )
}
