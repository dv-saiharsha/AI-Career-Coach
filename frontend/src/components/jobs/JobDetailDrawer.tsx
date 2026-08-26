'use client'

import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Link from 'next/link'
import { Bookmark, Briefcase, Building2, Check, Clock, ExternalLink, FileText, MapPin, MessageSquare, Wand2, X } from 'lucide-react'
import type { JobListing, WorkMode } from '@/lib/apiClient'
import type { TrackState } from '@/hooks/useApplyTracker'
import { ApplyTrackerButton } from '@/components/jobs/ApplyTrackerButton'

// Re-exported under the name the page imports it by. The API type is
// JobListing; JobPosting is kept as an alias so both names resolve to one
// definition rather than drifting apart.
export type JobPosting = JobListing

interface JobDetailDrawerProps {
  job: JobPosting | null
  isOpen: boolean
  onClose: () => void
  /** Send this listing to /resume to score a resume against it. */
  onMatchResume: (job: JobPosting) => void
  /** Start interview practice pre-filled with this role. */
  onPracticeInterview: (job: JobPosting) => void
  /** Whether opening this posting has already been recorded as an application. */
  applyState?: TrackState
  onApply?: (job: JobPosting) => void
  onUndoApply?: (job: JobPosting) => void
  /** Save this listing to the application pipeline. Optional so the drawer
   * still renders anywhere the pipeline isn't wired up. */
  onSaveToPipeline?: (job: JobPosting) => void
  /** Drives the save button's label. Owned by the page, which knows whether
   * the request succeeded — the drawer must not claim "Saved" on its own. */
  saveState?: 'idle' | 'saving' | 'saved'
}

const MODE_STYLES: Record<WorkMode, string> = {
  Remote: 'text-[var(--color-ok)] border-[var(--color-ok)]/25 bg-[var(--color-ok)]/5',
  Hybrid: 'text-[var(--color-accent)] border-[var(--color-accent)]/25 bg-[var(--color-accent)]/5',
  'On-site': 'text-[var(--color-warn)] border-[var(--color-warn)]/25 bg-[var(--color-warn)]/5',
}

function postedLabel(days: number): string {
  if (days <= 0) return 'Posted today'
  if (days === 1) return 'Posted 1 day ago'
  return `Posted ${days} days ago`
}

export function JobDetailDrawer({
  job,
  isOpen,
  onClose,
  onMatchResume,
  onPracticeInterview,
  onSaveToPipeline,
  saveState = 'idle',
  applyState = 'idle',
  onApply,
  onUndoApply,
}: JobDetailDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null)

  // Escape to dismiss. Bound on the document rather than the panel so it
  // works regardless of where focus currently sits.
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  // Lock background scroll while open, restoring whatever the page had set
  // rather than assuming it was ''.
  useEffect(() => {
    if (!isOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [isOpen])

  // Move focus into the panel on open so keyboard and screen-reader users
  // land inside the dialog instead of staying behind it on the page.
  useEffect(() => {
    if (isOpen) closeRef.current?.focus()
  }, [isOpen])

  return (
    <AnimatePresence>
      {isOpen && job && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-[var(--color-ink)]/25 backdrop-blur-sm"
            aria-hidden="true"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="job-drawer-title"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-xl flex-col border-l border-[var(--color-canvas-line)] bg-[var(--color-canvas-raise)] shadow-[var(--shadow-pop)]"
          >
            <div className="flex items-start justify-between gap-4 border-b border-[var(--color-canvas-line)] p-5">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-accent-tint)]">
                  <Building2 className="h-5 w-5 text-[var(--color-accent)]" strokeWidth={1.5} />
                </div>
                <div className="min-w-0">
                  <h2
                    id="job-drawer-title"
                    className="text-base font-semibold leading-snug text-[var(--color-ink)]"
                  >
                    {job.title}
                  </h2>
                  <p className="mt-1 text-sm text-[var(--color-ink-dim)]">{job.company}</p>
                </div>
              </div>
              <button
                ref={closeRef}
                onClick={onClose}
                aria-label="Close job details"
                className="shrink-0 rounded-lg p-1.5 text-[var(--color-ink-dim)] transition-colors hover:bg-[var(--color-canvas-deep)] hover:text-[var(--color-ink)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-dim)]">
                <span
                  className={`rounded-full border px-2 py-1 font-medium ${MODE_STYLES[job.workMode]}`}
                >
                  {job.workMode}
                </span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {job.location}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {postedLabel(job.postedDaysAgo)}
                </span>
              </div>

              <div className="mt-4 rounded-xl border border-[var(--color-canvas-line)] bg-[var(--color-canvas-deep)] px-4 py-3">
                <div className="text-xs text-[var(--color-ink-faint)]">Compensation</div>
                <div className="mt-0.5 text-sm font-medium text-[var(--color-ink)]">
                  {job.salaryRange}
                </div>
              </div>

              {job.skills.length > 0 && (
                <section className="mt-5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
                    Skills mentioned
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {job.skills.map((skill) => (
                      <span key={skill} className="chip">
                        {skill}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              <section className="mt-5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
                  Description
                </h3>
                {job.description ? (
                  // whitespace-pre-line preserves the source's paragraph breaks
                  // without trusting it enough to render as HTML.
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[var(--color-ink-subtle)]">
                    {job.description}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-[var(--color-ink-faint)]">
                    No description was published for this listing. Use Apply to read it at the
                    source.
                  </p>
                )}
              </section>
            </div>

            <div className="space-y-2 border-t border-[var(--color-canvas-line)] p-5">
              {onApply && onUndoApply ? (
                <ApplyTrackerButton
                  job={job}
                  state={applyState ?? 'idle'}
                  onApply={onApply}
                  onUndo={onUndoApply}
                  variant="block"
                />
              ) : (
                <a
                  href={job.applyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary flex w-full items-center justify-center gap-2"
                >
                  Apply
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => onMatchResume(job)}
                  className="btn-secondary flex items-center justify-center gap-2"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Match resume
                </button>
                <button
                  onClick={() => onPracticeInterview(job)}
                  className="btn-secondary flex items-center justify-center gap-2"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  Practice
                </button>
              </div>
              {onSaveToPipeline && (
                <button
                  onClick={() => onSaveToPipeline(job)}
                  disabled={saveState !== 'idle'}
                  className="btn-secondary flex w-full items-center justify-center gap-2 disabled:opacity-60"
                >
                  {saveState === 'saved' ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      Saved to pipeline
                    </>
                  ) : (
                    <>
                      <Bookmark className="h-3.5 w-3.5" />
                      {saveState === 'saving' ? 'Saving…' : 'Save to pipeline'}
                    </>
                  )}
                </button>
              )}
              {/* Straight to the split view rather than through the analyzer:
                  the tailor page picks the newest scan itself, so a user who
                  has already scanned does not re-upload to see what this
                  posting wants. */}
              <Link
                href={`/resume/tailor?job=${job.id}`}
                className="btn-secondary flex w-full items-center justify-center gap-2"
              >
                <Wand2 className="h-3.5 w-3.5" />
                Tailor my resume for this
              </Link>
              <p className="pt-1 text-center text-[11px] text-[var(--color-ink-faint)]">
                <Briefcase className="mr-1 inline h-3 w-3" />
                Match sends this posting to the resume analyzer
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
