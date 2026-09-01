'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Clock, Layers, X } from 'lucide-react'
import { getQualityReport, type QualityReport } from '@/lib/apiClient'
import { Skeleton } from '@/components/ui/skeleton'
import { ParsingReadinessCard } from './ParsingReadinessCard'

interface ResumeQualityPanelProps {
  analysisId: number
}

/** Section names come back lowercase from the segmenter. */
const SECTION_LABELS: Record<string, string> = {
  experience: 'Experience',
  projects: 'Projects',
  skills: 'Skills',
  education: 'Education',
  certifications: 'Certifications',
  other: 'Header/Summary',
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <span className="eyebrow mb-1.5 block text-[10px]">{label}</span>
      <div className="font-mono text-lg tabular-nums text-[var(--color-ink)]">{value}</div>
      {hint && <p className="mt-0.5 text-xs text-[var(--color-ink-dim)]">{hint}</p>}
    </div>
  )
}

function GradePips({ evaluation }: { evaluation: QualityReport['bullets']['bullets'][number] }) {
  const checks = [
    { label: 'Action verb', met: evaluation.has_strong_verb },
    { label: 'Metric', met: evaluation.has_metric },
    { label: 'Tool/method', met: evaluation.has_tool_context },
  ]
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {checks.map((check) => (
        <span key={check.label} className="flex items-center gap-1">
          {check.met ? (
            <Check strokeWidth={2} className="h-3 w-3 shrink-0 text-[var(--color-signal-high)]" />
          ) : (
            <X strokeWidth={2} className="h-3 w-3 shrink-0 text-[var(--color-ink-faint)]" />
          )}
          <span
            className="text-[10px]"
            style={{
              color: check.met ? 'var(--color-ink-dim)' : 'var(--color-ink-faint)',
            }}
          >
            {check.label}
          </span>
        </span>
      ))}
    </div>
  )
}

export function ResumeQualityPanel({ analysisId }: ResumeQualityPanelProps) {
  const [report, setReport] = useState<QualityReport | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  // No setLoading(true) here: useState(true) already covers the initial
  // fetch, and the mount site keys this component on the analysis id, so a
  // new scan remounts with fresh state rather than reusing stale data.
  useEffect(() => {
    let cancelled = false
    getQualityReport(analysisId)
      .then((data) => {
        if (!cancelled) setReport(data)
      })
      .catch(() => {
        // A diagnostic panel failing must not read like the scan failed —
        // the score above it is still valid.
        if (!cancelled) setError('Could not load the resume breakdown.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [analysisId])

  if (loading) {
    // Matches the loaded layout's box so nothing shifts when data arrives.
    return (
      <div className="card space-y-4 p-6">
        <Skeleton className="h-3 w-40" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
        <Skeleton className="h-20" />
      </div>
    )
  }

  if (error || !report) {
    return (
      <div className="card p-6">
        <p className="text-sm text-[var(--color-ink-dim)]">{error || 'No breakdown available.'}</p>
      </div>
    )
  }

  const { bullets, skill_contexts, role_recency, domain_gaps, parsing_readiness } = report
  const stuffed = skill_contexts.filter((s) => s.stuffed)
  const weakBullets = bullets.bullets.filter((b) => b.grade < 3)
  const gapDomains = Object.entries(domain_gaps)

  return (
    <div className="flex flex-col gap-5">
      {/* Structural readiness first: if the file can't be parsed at all, the
          content advice below it is moot. */}
      {parsing_readiness && <ParsingReadinessCard readiness={parsing_readiness} />}

      <div className="card space-y-6 p-6">
        <div>
          <div className="eyebrow mb-1">Resume breakdown</div>
          <p className="text-xs leading-relaxed text-[var(--color-ink-dim)]">
            Why the resume reads the way it does. These are diagnostics, not a second score — your
            match score above comes from the trained model and nothing here changes it.
          </p>
        </div>

        {bullets.bullet_count > 0 && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Bullets" value={String(bullets.bullet_count)} />
            <Stat
              label="Quantified"
              value={`${bullets.quantified_ratio}%`}
              hint={bullets.quantified_ratio < 50 ? 'Aim for most bullets' : 'Good coverage'}
            />
            <Stat label="Strong verbs" value={`${bullets.strong_verb_ratio}%`} />
            <Stat
              label="Weak openers"
              value={String(bullets.weak_opener_count)}
              hint={bullets.weak_opener_count > 0 ? '"Responsible for", "Helped with"' : 'None'}
            />
          </div>
        )}

        {/* Bullets needing work — the actionable worklist, weakest first. */}
        {weakBullets.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="flex w-full items-center justify-between border-t border-[var(--color-canvas-line)] pt-4 text-left"
            >
              <span className="text-sm font-medium text-[var(--color-ink)]">
                {weakBullets.length} bullet{weakBullets.length !== 1 ? 's' : ''} could be stronger
              </span>
              <ChevronDown
                strokeWidth={1.5}
                className="h-4 w-4 shrink-0 text-[var(--color-ink-faint)] transition-transform"
                style={{ transform: expanded ? 'rotate(180deg)' : 'none' }}
              />
            </button>

              {expanded && (
                <div
                 
                 
                 
                 
                  className="overflow-hidden panel-enter"
                >
                  <div className="mt-3 flex flex-col gap-3">
                    {weakBullets.map((evaluation, index) => (
                      <div
                        key={`${evaluation.bullet.slice(0, 40)}-${index}`}
                        className="rounded-[10px] border-l-[3px] py-2.5 pl-3 pr-4"
                        style={{
                          borderLeftColor:
                            evaluation.grade === 0
                              ? 'var(--color-signal-low)'
                              : 'var(--color-signal-mid)',
                          background: 'var(--color-canvas)',
                        }}
                      >
                        <p className="text-sm leading-relaxed text-[var(--color-ink-subtle)]">
                          {evaluation.bullet}
                        </p>
                        <div className="mt-2">
                          <GradePips evaluation={evaluation} />
                        </div>
                        {evaluation.suggestions.length > 0 && (
                          <ul className="mt-2 flex flex-col gap-1">
                            {evaluation.suggestions.map((suggestion) => (
                              <li key={suggestion} className="text-xs text-[var(--color-ink-dim)]">
                                {suggestion}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
          </div>
        )}

        {/* Keyword stuffing */}
        {stuffed.length > 0 && (
          <div className="border-t border-[var(--color-canvas-line)] pt-4">
            <div className="mb-2 flex items-center gap-2">
              <AlertTriangle
                strokeWidth={1.5}
                className="h-3.5 w-3.5 text-[var(--color-signal-mid)]"
              />
              <span className="text-sm font-medium text-[var(--color-ink)]">
                Listed but not evidenced
              </span>
            </div>
            <p className="text-xs leading-relaxed text-[var(--color-ink-dim)]">
              {stuffed.map((s) => s.skill).join(', ')} appear
              {stuffed.length === 1 ? 's' : ''} several times in a list but never inside an
              experience bullet or project. Show where you used{' '}
              {stuffed.length === 1 ? 'it' : 'them'} — a reviewer reads a repeated list as padding.
            </p>
          </div>
        )}

        {/* Recency */}
        {role_recency.length > 0 && (
          <div className="border-t border-[var(--color-canvas-line)] pt-4">
            <div className="mb-2.5 flex items-center gap-2">
              <Clock strokeWidth={1.5} className="h-3.5 w-3.5 text-[var(--color-ink-faint)]" />
              <span className="text-sm font-medium text-[var(--color-ink)]">
                Experience recency
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {role_recency.map((role, index) => (
                <div
                  key={`${role.title}-${role.company}-${index}`}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="truncate text-xs text-[var(--color-ink-subtle)]">
                    {role.title}
                    {role.company && (
                      <span className="text-[var(--color-ink-faint)]"> · {role.company}</span>
                    )}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-[10px] text-[var(--color-ink-faint)]">
                      {role.dates || 'no dates'}
                    </span>
                    <div
                      className="h-1 w-12 overflow-hidden rounded-full"
                      style={{ background: 'var(--color-canvas-line)' }}
                      aria-hidden="true"
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${role.recency_credit * 100}%`,
                          background:
                            role.recency_credit > 0.8
                              ? 'var(--color-signal-high)'
                              : 'var(--color-signal-mid)',
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-[var(--color-ink-faint)]">
              Skills used in a current role carry more weight than the same skills from years ago.
              Undated roles are not penalised.
            </p>
          </div>
        )}

        {/* Gaps grouped by domain */}
        {gapDomains.length > 0 && (
          <div className="border-t border-[var(--color-canvas-line)] pt-4">
            <div className="mb-2.5 flex items-center gap-2">
              <Layers strokeWidth={1.5} className="h-3.5 w-3.5 text-[var(--color-ink-faint)]" />
              <span className="text-sm font-medium text-[var(--color-ink)]">Gaps by area</span>
            </div>
            <div className="flex flex-col gap-2.5">
              {gapDomains.map(([domain, skills]) => (
                <div key={domain}>
                  <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">
                    {domain}
                  </span>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {skills.map((skill) => (
                      <span key={skill} className="chip">
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Where each matched skill actually appears */}
        {skill_contexts.some((s) => s.found) && (
          <div className="border-t border-[var(--color-canvas-line)] pt-4">
            <span className="eyebrow mb-2 block text-[10px]">Where your skills appear</span>
            <div className="flex flex-col gap-1.5">
              {skill_contexts
                .filter((s) => s.found)
                .map((context) => (
                  <div key={context.skill} className="flex items-center justify-between gap-3">
                    <span className="truncate text-xs text-[var(--color-ink-subtle)]">
                      {context.skill}
                    </span>
                    <span className="shrink-0 text-[10px] text-[var(--color-ink-faint)]">
                      {context.sections.map((s) => SECTION_LABELS[s] ?? s).join(' · ')}
                    </span>
                  </div>
                ))}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-[var(--color-ink-faint)]">
              A skill shown inside an experience bullet is evidenced. The same word in a list is a
              claim.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
