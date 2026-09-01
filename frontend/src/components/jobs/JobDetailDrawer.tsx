'use client'

import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Link from 'next/link'
import { Bookmark, Briefcase, Building2, Check, Clock, ExternalLink, FileText, Lightbulb, Mail, MapPin, MessageSquare, Wand2, X } from 'lucide-react'
import type { JobListing, WorkMode } from '@/lib/apiClient'
import type { TrackState } from '@/hooks/useApplyTracker'
import { ApplyTrackerButton } from '@/components/jobs/ApplyTrackerButton'
import { ScoreRing } from '@/components/ScoreRing'

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
  Remote: 'text-(--color-ok) border-(--color-ok)/25 bg-(--color-ok)/5',
  Hybrid: 'text-(--color-accent) border-(--color-accent)/25 bg-(--color-accent)/5',
  'On-site': 'text-(--color-warn) border-(--color-warn)/25 bg-(--color-warn)/5',
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
            className="fixed inset-0 z-40 bg-(--color-ink)/25 backdrop-blur-sm"
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
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-xl flex-col border-l border-(--color-canvas-line) bg-(--color-canvas-raise) shadow-(--shadow-pop)"
          >
            <div className="flex items-start justify-between gap-4 border-b border-(--color-canvas-line) p-5">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-(--color-accent-tint)">
                  <Building2 className="h-5 w-5 text-(--color-accent)" strokeWidth={1.5} />
                </div>
                <div className="min-w-0">
                  <h2
                    id="job-drawer-title"
                    className="text-base font-semibold leading-snug text-(--color-ink)"
                  >
                    {job.title}
                  </h2>
                  <p className="mt-1 text-sm text-(--color-ink-dim)">{job.company}</p>
                </div>
              </div>
              <button
                ref={closeRef}
                onClick={onClose}
                aria-label="Close job details"
                className="shrink-0 rounded-lg p-1.5 text-(--color-ink-dim) transition-colors hover:bg-(--color-canvas-deep) hover:text-(--color-ink)"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <div className="flex flex-wrap items-center gap-2 text-xs text-(--color-ink-dim)">
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

              {/* Only when the caller has a primary resume — matching was
                  skipped entirely otherwise, not computed as null per field. */}
              {job.match && (
                <section className="mt-4 rounded-xl border border-(--color-canvas-line) bg-(--color-canvas-deep) p-4">
                  <div className="flex items-center gap-4">
                    {job.match.overallMatch != null && job.match.band ? (
                      <ScoreRing value={job.match.overallMatch} band={job.match.band} label="Resume Match" size={84} strokeWidth={6} />
                    ) : (
                      <div className="text-xs text-(--color-ink-faint)">
                        Not enough information in this listing to score a match.
                      </div>
                    )}
                    <p className="text-sm leading-relaxed text-(--color-ink-subtle)">{job.match.explanation}</p>
                  </div>

                  {job.match.skillsMatch && (
                    <div className="mt-4 grid grid-cols-1 gap-3 border-t border-(--color-canvas-line) pt-4 sm:grid-cols-2">
                      <div>
                        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-(--color-ink-faint)">
                          Matching skills
                        </h4>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {job.match.skillsMatch.matchingSkills.map((skill) => (
                            <span key={skill} className="chip" style={{ borderColor: 'var(--color-signal-high)', color: 'var(--color-signal-high)' }}>
                              {skill}
                            </span>
                          ))}
                          {job.match.skillsMatch.matchingSkills.length === 0 && (
                            <p className="text-xs text-(--color-ink-faint)">None of the listed skills matched.</p>
                          )}
                        </div>
                      </div>
                      <div>
                        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-(--color-ink-faint)">
                          Missing skills
                        </h4>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {job.match.skillsMatch.missingSkills.map((skill) => (
                            <span key={skill} className="chip" style={{ borderColor: 'var(--color-signal-low)', color: 'var(--color-signal-low)' }}>
                              {skill}
                            </span>
                          ))}
                          {job.match.skillsMatch.missingSkills.length === 0 && (
                            <p className="text-xs text-(--color-ink-faint)">Every listed skill matched.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {job.match.skillsMatch && job.match.skillsMatch.learningRecommendations.length > 0 && (
                    <div className="mt-4 flex items-start gap-2 border-t border-(--color-canvas-line) pt-4">
                      <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-(--color-ink-faint)" />
                      <p className="text-xs leading-relaxed text-(--color-ink-dim)">
                        Worth learning: {job.match.skillsMatch.learningRecommendations.join(' · ')}
                      </p>
                    </div>
                  )}
                </section>
              )}

              <div className="mt-4 rounded-xl border border-(--color-canvas-line) bg-(--color-canvas-deep) px-4 py-3">
                <div className="text-xs text-(--color-ink-faint)">Compensation</div>
                <div className="mt-0.5 text-sm font-medium text-(--color-ink)">
                  {job.salaryRange}
                </div>
              </div>

              {/* Plain list when there's no match to compare against (no
                  resume on file) — the matched/missing breakdown above
                  already supersedes this same list once a match exists, so
                  showing both would repeat the same skills twice. */}
              {job.skills.length > 0 && !job.match?.skillsMatch && (
                <section className="mt-5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-(--color-ink-faint)">
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
                <h3 className="text-xs font-semibold uppercase tracking-wide text-(--color-ink-faint)">
                  Description
                </h3>
                {job.description ? (
                  // whitespace-pre-line preserves the source's paragraph breaks
                  // without trusting it enough to render as HTML.
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-(--color-ink-subtle)">
                    {job.description}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-(--color-ink-faint)">
                    No description was published for this listing. Use Apply to read it at the
                    source.
                  </p>
                )}
              </section>
            </div>

            <div className="space-y-2 border-t border-(--color-canvas-line) p-5">
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
                href={`/cover-letter?job=${job.id}`}
                className="btn-secondary flex w-full items-center justify-center gap-2"
              >
                <Mail className="h-3.5 w-3.5" />
                Write a cover letter
              </Link>
              <Link
                href={`/resume/tailor?job=${job.id}`}
                className="btn-secondary flex w-full items-center justify-center gap-2"
              >
                <Wand2 className="h-3.5 w-3.5" />
                Tailor my resume for this
              </Link>
              <p className="pt-1 text-center text-[11px] text-(--color-ink-faint)">
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
