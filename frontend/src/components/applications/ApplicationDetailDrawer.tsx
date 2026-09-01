'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Presence, EXIT_SLOW } from '@/lib/presence'
import {
  ArrowRight,
  Briefcase,
  Building2,
  ExternalLink,
  FileSearch,
  Mail,
  MapPin,
  MessageSquareText,
  Sparkles,
  Trash2,
  User,
  X,
} from 'lucide-react'
import {
  APPLICATION_STAGES,
  deleteApplication,
  getApplicationDetail,
  updateApplication,
  updateApplicationStatus,
  type ApplicationStatus,
} from '@/lib/apiClient'
import { STAGE_LABELS, STAGE_MARKERS } from '@/lib/applicationStages'
import { bandColor, bandLabel } from '@/lib/scoreBands'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { InlineError } from '@/components/resume/InlineError'

const PIPELINE_KEY = ['applications', 'pipeline'] as const
const ACTIVITY_KEY = ['applications', 'activity'] as const

const COACH_PROMPTS = (company: string, role: string) => [
  { key: 'improve', label: 'How can I improve this application?', prompt: `How can I improve my application to ${company} for the ${role} role?` },
  { key: 'follow-up', label: 'Should I follow up?', prompt: `Should I follow up on my application to ${company} for the ${role} role, and if so, how?` },
  { key: 'prepare', label: 'Prepare me for this company.', prompt: `Help me prepare for an interview at ${company} for the ${role} role.` },
  { key: 'resume', label: 'Improve my resume for this role.', prompt: `How should I improve my resume specifically for the ${role} role at ${company}?` },
]

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

interface ApplicationDetailDrawerProps {
  applicationId: number | null
  onClose: () => void
}

export function ApplicationDetailDrawer({ applicationId, onClose }: ApplicationDetailDrawerProps) {
  const isOpen = applicationId != null
  const queryClient = useQueryClient()
  const closeRef = useRef<HTMLButtonElement>(null)
  const [notesDraft, setNotesDraft] = useState('')
  const [recruiterNameDraft, setRecruiterNameDraft] = useState('')
  const [recruiterEmailDraft, setRecruiterEmailDraft] = useState('')

  const { data: detail, isLoading, isError } = useQuery({
    queryKey: ['applications', 'detail', applicationId],
    queryFn: () => getApplicationDetail(applicationId as number),
    enabled: isOpen,
  })

  useEffect(() => {
    if (!detail) return
    // Seeding local editable drafts from a freshly (re)fetched query result —
    // not a per-render mirror of props/state.
    /* eslint-disable react-hooks/set-state-in-effect */
    setNotesDraft(detail.application.notes ?? '')
    setRecruiterNameDraft(detail.application.recruiter_name ?? '')
    setRecruiterEmailDraft(detail.application.recruiter_email ?? '')
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [detail])

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: PIPELINE_KEY })
    queryClient.invalidateQueries({ queryKey: ACTIVITY_KEY })
    if (applicationId != null) {
      queryClient.invalidateQueries({ queryKey: ['applications', 'detail', applicationId] })
    }
  }

  const statusMutation = useMutation({
    mutationFn: (status: ApplicationStatus) => updateApplicationStatus(applicationId as number, status),
    onSuccess: invalidateAll,
  })
  const fieldsMutation = useMutation({
    mutationFn: (patch: { notes?: string; recruiter_name?: string; recruiter_email?: string }) =>
      updateApplication(applicationId as number, patch),
    onSuccess: invalidateAll,
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteApplication(applicationId as number),
    onSuccess: () => {
      // Close first: invalidating the detail query after the row is gone
      // would just refetch a 404 for an id nothing renders anymore.
      onClose()
      queryClient.invalidateQueries({ queryKey: PIPELINE_KEY })
      queryClient.invalidateQueries({ queryKey: ACTIVITY_KEY })
      if (applicationId != null) {
        queryClient.removeQueries({ queryKey: ['applications', 'detail', applicationId] })
      }
    },
  })

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [isOpen])

  useEffect(() => {
    if (isOpen) closeRef.current?.focus()
  }, [isOpen])

  const application = detail?.application

  return (
    <Presence open={Boolean(isOpen)} duration={EXIT_SLOW}>
      {(state) => (
        <>
          <div
            data-state={state}
            onClick={onClose}
            className="presence-scrim fixed inset-0 z-40"
            style={{ background: 'color-mix(in srgb, black 45%, transparent)' }}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={application ? `${application.job_title} at ${application.company}` : 'Application detail'}
            data-state={state}
            className="presence-drawer fixed inset-y-0 right-0 z-50 flex w-full max-w-[560px] flex-col overflow-y-auto"
            style={{ background: 'var(--color-canvas)', borderLeft: '1px solid var(--color-canvas-line)' }}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-(--color-canvas-line) bg-(--color-canvas) px-5 py-4">
              <span className="eyebrow">Application</span>
              <Button ref={closeRef} type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
                <X strokeWidth={1.5} />
              </Button>
            </div>

            <div className="flex-1 p-5">
              {isLoading && (
                <div className="flex flex-col gap-3">
                  <Skeleton className="h-8 w-2/3" />
                  <Skeleton className="h-24" />
                  <Skeleton className="h-40" />
                </div>
              )}

              {isError && <InlineError message="Could not load this application. Check that the API is running and try again." />}

              {application && detail && (
                <>
                  <h2 className="font-display text-xl font-medium text-(--color-ink)">{application.job_title}</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-(--color-ink-dim)">
                    <span className="flex items-center gap-1.5">
                      <Building2 strokeWidth={1.5} className="h-3.5 w-3.5" />
                      {application.company}
                    </span>
                    {application.location && (
                      <span className="flex items-center gap-1.5">
                        <MapPin strokeWidth={1.5} className="h-3.5 w-3.5" />
                        {application.location}
                      </span>
                    )}
                    {application.salary_range && (
                      <span className="font-mono text-xs">{application.salary_range}</span>
                    )}
                    {application.job_url && (
                      <a
                        href={application.job_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="flex items-center gap-1 text-(--color-accent) hover:underline"
                      >
                        Posting <ExternalLink strokeWidth={1.5} className="h-3 w-3" />
                      </a>
                    )}
                  </div>

                  {/* Stage */}
                  <div className="mt-4">
                    <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-(--color-ink-faint)" htmlFor="detail-stage">
                      Stage
                    </label>
                    <select
                      id="detail-stage"
                      value={application.status}
                      disabled={statusMutation.isPending}
                      onChange={(e) => statusMutation.mutate(e.target.value as ApplicationStatus)}
                      className="w-full rounded-lg px-3 py-2 text-sm font-medium text-(--color-ink) disabled:opacity-50"
                      style={{ background: 'var(--color-canvas-raise)', border: '1px solid var(--color-canvas-line)' }}
                    >
                      {APPLICATION_STAGES.map((stage) => (
                        <option key={stage} value={stage}>
                          {STAGE_LABELS[stage]}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Recruiter contact */}
                  <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-(--color-ink-faint)" htmlFor="recruiter-name">
                        <User strokeWidth={1.5} className="h-3 w-3" /> Recruiter
                      </label>
                      <Input
                        id="recruiter-name"
                        value={recruiterNameDraft}
                        onChange={(e) => setRecruiterNameDraft(e.target.value)}
                        onBlur={() => {
                          if (recruiterNameDraft !== (application.recruiter_name ?? '')) {
                            fieldsMutation.mutate({ recruiter_name: recruiterNameDraft })
                          }
                        }}
                        placeholder="Recruiter name"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-(--color-ink-faint)" htmlFor="recruiter-email">
                        <Mail strokeWidth={1.5} className="h-3 w-3" /> Email
                      </label>
                      <Input
                        id="recruiter-email"
                        type="email"
                        value={recruiterEmailDraft}
                        onChange={(e) => setRecruiterEmailDraft(e.target.value)}
                        onBlur={() => {
                          if (recruiterEmailDraft !== (application.recruiter_email ?? '')) {
                            fieldsMutation.mutate({ recruiter_email: recruiterEmailDraft })
                          }
                        }}
                        placeholder="recruiter@company.com"
                      />
                    </div>
                  </div>

                  {/* Notes */}
                  <div className="mt-4">
                    <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-(--color-ink-faint)" htmlFor="detail-notes">
                      Notes
                    </label>
                    <Textarea
                      id="detail-notes"
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      onBlur={() => {
                        if (notesDraft !== (application.notes ?? '')) fieldsMutation.mutate({ notes: notesDraft })
                      }}
                      rows={3}
                      placeholder="Anything worth remembering about this one…"
                    />
                  </div>

                  {/* Resume */}
                  {detail.resume && (
                    <section className="mt-6 border-t border-(--color-canvas-line) pt-5">
                      <span className="eyebrow mb-2 inline-flex items-center gap-1.5">
                        <FileSearch className="h-3 w-3" /> Resume used
                      </span>
                      <div className="flex items-center justify-between rounded-[10px] p-3" style={{ background: 'var(--color-canvas-raise)', border: '1px solid var(--color-canvas-line)' }}>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-(--color-ink)">{detail.resume.filename}</p>
                          <p className="text-xs text-(--color-ink-faint)">Scanned {formatDate(detail.resume.scanned_at)}</p>
                        </div>
                        <span className="shrink-0 font-mono text-sm font-medium" style={{ color: bandColor(detail.resume.band) }}>
                          {detail.resume.ats_score.toFixed(0)} · {bandLabel(detail.resume.band)}
                        </span>
                      </div>
                      <Link href="/resume" className="mt-2 inline-flex items-center gap-1 text-xs text-(--color-accent) hover:underline">
                        Review this resume <ArrowRight strokeWidth={1.5} className="h-3 w-3" />
                      </Link>
                    </section>
                  )}

                  {/* Job match */}
                  {detail.job_match && (
                    <section className="mt-6 border-t border-(--color-canvas-line) pt-5">
                      <span className="eyebrow mb-2 inline-flex items-center gap-1.5">
                        <Briefcase className="h-3 w-3" /> Job match
                      </span>
                      {detail.job_match.overall_match != null && detail.job_match.band && (
                        <p className="mb-1.5 text-sm font-medium" style={{ color: bandColor(detail.job_match.band) }}>
                          {detail.job_match.overall_match.toFixed(0)}% · {bandLabel(detail.job_match.band)}
                        </p>
                      )}
                      <p className="text-sm leading-relaxed text-(--color-ink-dim)">{detail.job_match.explanation}</p>
                      {detail.job_match.missing_skills.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {detail.job_match.missing_skills.slice(0, 6).map((skill) => (
                            <span key={skill} className="chip text-[11px]">{skill}</span>
                          ))}
                        </div>
                      )}
                    </section>
                  )}

                  {/* Interview */}
                  <section className="mt-6 border-t border-(--color-canvas-line) pt-5">
                    <span className="eyebrow mb-2 inline-flex items-center gap-1.5">
                      <MessageSquareText className="h-3 w-3" /> Interview readiness
                    </span>
                    {detail.has_in_progress_interview && (
                      <p className="mb-2 text-xs text-(--color-accent)">
                        You have a mock interview for this role in progress.
                      </p>
                    )}
                    {detail.interview ? (
                      <>
                        <p className="mb-1.5 text-sm font-medium" style={{ color: bandColor(detail.interview.readiness_band) }}>
                          {detail.interview.overall_score.toFixed(1)} / 10 · {bandLabel(detail.interview.readiness_band)}
                        </p>
                        {detail.interview.topics_to_improve.length > 0 && (
                          <ul className="mb-2 space-y-1">
                            {detail.interview.topics_to_improve.slice(0, 3).map((topic) => (
                              <li key={topic} className="flex items-start gap-2 text-xs text-(--color-ink-dim)">
                                <span className="text-(--color-ink-faint)">—</span>
                                {topic}
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    ) : (
                      <p className="mb-2 text-sm text-(--color-ink-faint)">
                        No completed mock interview for this role yet.
                      </p>
                    )}
                    <Link
                      href={`/interview?role=${encodeURIComponent(application.job_title)}`}
                      className="inline-flex items-center gap-1 text-xs text-(--color-accent) hover:underline"
                    >
                      Practice for this role <ArrowRight strokeWidth={1.5} className="h-3 w-3" />
                    </Link>
                  </section>

                  {/* Career Coach */}
                  <section className="mt-6 border-t border-(--color-canvas-line) pt-5">
                    <span className="eyebrow mb-2 inline-flex items-center gap-1.5">
                      <Sparkles className="h-3 w-3" /> Ask the Career Coach
                    </span>
                    <div className="flex flex-col gap-1.5">
                      {COACH_PROMPTS(application.company, application.job_title).map((item) => (
                        <Link
                          key={item.key}
                          href={`/coach?prompt=${encodeURIComponent(item.prompt)}`}
                          className="rounded-sm px-3 py-2 text-left text-sm text-(--color-ink-dim) transition-colors hover:bg-(--color-canvas-raise) hover:text-(--color-ink)"
                          style={{ border: '1px solid var(--color-canvas-line)' }}
                        >
                          {item.label}
                        </Link>
                      ))}
                    </div>
                  </section>

                  {/* Status history / per-application timeline */}
                  {detail.status_history.length > 0 && (
                    <section className="mt-6 border-t border-(--color-canvas-line) pt-5">
                      <span className="eyebrow mb-2 inline-flex">Timeline</span>
                      <ol className="flex flex-col gap-2.5">
                        {detail.status_history.map((entry, index) => (
                          <li key={index} className="flex items-center gap-2.5 text-xs">
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ background: STAGE_MARKERS[entry.to_status] }}
                              aria-hidden="true"
                            />
                            <span className="text-(--color-ink-dim)">{STAGE_LABELS[entry.to_status]}</span>
                            <span className="ml-auto font-mono text-(--color-ink-faint)">{formatDate(entry.changed_at)}</span>
                          </li>
                        ))}
                      </ol>
                    </section>
                  )}

                  <div className="mt-6 border-t border-(--color-canvas-line) pt-5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteMutation.mutate()}
                      disabled={deleteMutation.isPending}
                      className="gap-1.5 text-(--color-signal-low) hover:bg-(--color-signal-low)/10"
                    >
                      <Trash2 strokeWidth={1.5} className="h-3.5 w-3.5" />
                      {deleteMutation.isPending ? 'Removing…' : 'Remove application'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </Presence>
  )
}
