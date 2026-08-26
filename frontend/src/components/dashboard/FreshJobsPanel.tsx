'use client'

import { ArrowUpRight, Clock, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { FreshJob } from '@/lib/apiClient'

interface FreshJobsPanelProps {
  jobs: FreshJob[]
  /** Which window actually produced these — "last 10 hours" or "last 7 days". */
  window: string
}

/**
 * Recently posted listings.
 *
 * The heading names the window the backend actually used rather than always
 * claiming "fresh": when too few roles were posted in the last 10 hours the
 * query widens, and labelling day-old cards as hours-old would be the
 * misleading version of that fallback.
 */
export function FreshJobsPanel({ jobs, window }: FreshJobsPanelProps) {
  if (jobs.length === 0) {
    return (
      <div className="card p-6">
        <div className="eyebrow mb-2">New postings</div>
        <p className="text-sm text-[var(--color-ink-faint)]">
          Nothing posted recently. Run a job sweep to refresh the feed.
        </p>
      </div>
    )
  }

  return (
    <div className="card p-6">
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="eyebrow">New postings</div>
        <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-faint)]">
          {window}
        </span>
      </div>
      <p className="mb-4 text-xs text-[var(--color-ink-dim)]">
        Dated by when the employer listed the role, not when we indexed it.
      </p>

      <ul className="flex flex-col gap-2">
        {jobs.map((job) => (
          <li key={job.id}>
            <a
              href={job.apply_url}
              target="_blank"
              rel="noreferrer noopener"
              className="group block rounded-[10px] border-l-[3px] py-2.5 pl-3 pr-4 transition-colors"
              style={{
                borderLeftColor: 'var(--color-canvas-line)',
                background: 'var(--color-canvas)',
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="text-sm font-medium leading-snug text-[var(--color-ink)]">
                  {job.title}
                </span>
                <ArrowUpRight
                  strokeWidth={1.5}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-ink-faint)] transition-colors group-hover:text-[var(--color-accent)]"
                />
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[var(--color-ink-faint)]">
                <span className="text-[var(--color-ink-dim)]">{job.company}</span>
                <span>·</span>
                <span>{job.location}</span>
                <span>·</span>
                <span>{job.work_mode}</span>
                <span className="ml-auto flex items-center gap-1 font-mono">
                  <Clock strokeWidth={1.5} className="h-3 w-3" />
                  {job.posted_label}
                </span>
              </div>

              {/* Only ever shown when the posting itself said something. An
                  absent value means nobody checked, which is not a finding. */}
              {job.h1b_sponsorship === 'explicitly_sponsored' && (
                <div className="mt-2 flex items-start gap-1.5">
                  <ShieldCheck
                    strokeWidth={1.5}
                    className="mt-0.5 h-3 w-3 shrink-0 text-[var(--color-signal-high)]"
                  />
                  <p className="text-[10px] leading-relaxed text-[var(--color-ink-dim)]">
                    States sponsorship is available
                    {job.h1b_evidence && (
                      <span className="text-[var(--color-ink-faint)]">
                        {' '}— &ldquo;{job.h1b_evidence}&rdquo;
                      </span>
                    )}
                  </p>
                </div>
              )}
              {job.h1b_sponsorship === 'no_sponsorship' && (
                <div className="mt-2 flex items-start gap-1.5">
                  <ShieldAlert
                    strokeWidth={1.5}
                    className="mt-0.5 h-3 w-3 shrink-0 text-[var(--color-signal-mid)]"
                  />
                  <p className="text-[10px] leading-relaxed text-[var(--color-ink-dim)]">
                    States no sponsorship
                    {job.h1b_evidence && (
                      <span className="text-[var(--color-ink-faint)]">
                        {' '}— &ldquo;{job.h1b_evidence}&rdquo;
                      </span>
                    )}
                  </p>
                </div>
              )}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
