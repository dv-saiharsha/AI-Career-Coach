'use client'

import { Check, ExternalLink, Loader2 } from 'lucide-react'

import type { JobListing } from '@/lib/apiClient'
import type { TrackState } from '@/hooks/useApplyTracker'

/**
 * Apply link that also records the application.
 *
 * Renders an anchor, not a button. The href is the real posting URL, so
 * middle-click, ctrl-click and "copy link address" all behave — a <button>
 * calling window.open breaks every one of them, and a job board is somewhere
 * people open six tabs at once. onClick handles the tracking and calls
 * preventDefault only for the plain left-click it actually handles.
 */
export function ApplyTrackerButton({
  job,
  state,
  onApply,
  onUndo,
  variant = 'inline',
}: {
  job: JobListing
  state: TrackState
  onApply: (job: JobListing) => void
  onUndo: (job: JobListing) => void
  variant?: 'inline' | 'block'
}) {
  const tracked = state === 'tracked' || state === 'existing'

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Modified clicks are the browser's to handle: the user asked for a
    // background tab or a new window, and hijacking that is worse than
    // missing one tracking event.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    onApply(job)
  }

  const label =
    state === 'tracking' ? 'Opening…' : tracked ? 'Applied' : 'Apply'

  return (
    <span className={variant === 'block' ? 'block' : 'inline-flex flex-col items-end gap-1'}>
      <a
        href={job.applyUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleClick}
        className={
          variant === 'block'
            ? 'btn-apply flex w-full items-center justify-center gap-2'
            : 'inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-accent)] transition-colors hover:text-[var(--color-accent-light)]'
        }
      >
        {state === 'tracking' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : tracked ? (
          <Check strokeWidth={2} className="h-3.5 w-3.5" />
        ) : null}
        {label}
        {!tracked && state !== 'tracking' && <ExternalLink className="h-3 w-3" />}
      </a>

      {/* Undo, not a confirmation dialog. Opening a posting is evidence of
          intent, not proof of an application, so the row is created
          optimistically and the correction is one click — asking first would
          put a modal between the user and the job they wanted to read. */}
      {tracked && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onUndo(job)
          }}
          className={`text-[10px] text-[var(--color-ink-faint)] underline-offset-2 transition-colors hover:text-[var(--color-ink)] hover:underline ${
            variant === 'block' ? 'mt-1.5 w-full text-center' : ''
          }`}
        >
          Didn&apos;t apply? Remove from pipeline
        </button>
      )}

      {state === 'failed' && (
        <span className={`text-[10px] text-[var(--color-ink-faint)] ${variant === 'block' ? 'mt-1.5 block text-center' : ''}`}>
          Opened, but couldn&apos;t save to your pipeline
        </span>
      )}
    </span>
  )
}
