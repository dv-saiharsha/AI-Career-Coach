'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import * as Tabs from '@radix-ui/react-tabs'
import {
  Briefcase, ChevronDown, FileSearch, Layers, Lightbulb,
  ListChecks, MessageSquareText, Search, Sparkles, Target, TrendingUp, Wand2,
} from 'lucide-react'
import { getResumeReview, type ResumeReview, type ReviewCategory } from '@/lib/apiClient'
import { ScoreRing } from '@/components/ScoreRing'
import { NextActionCard } from '@/components/NextActionCard'
import { Skeleton } from '@/components/ui/skeleton'
import { bandColor, bandLabel } from '@/lib/scoreBands'
import { InlineError } from './InlineError'

interface ResumeReviewPanelProps {
  analysisId: number
  /** From the original scan response — folded in here rather than kept as
   *  its own tab. Both were free-text improvement advice sitting one tab
   *  apart; showing the same kind of content in two places was the
   *  duplication, not the content itself. */
  suggestions: string[]
}

const PRIORITY_LABEL: Record<string, string> = {
  high: 'High priority',
  medium: 'Worth fixing',
  low: 'Minor',
  none: '',
}

const PRIORITY_COLOR: Record<string, string> = {
  high: 'var(--danger)',
  medium: 'var(--warning)',
  low: 'var(--color-ink-faint)',
  none: 'var(--color-ink-faint)',
}

const ACTION_ICON: Record<string, typeof Sparkles> = {
  improve_ats: FileSearch,
  improve_formatting: Layers,
  add_missing_skills: ListChecks,
  job_specific_review: Search,
  tailor_resume: Wand2,
  practice_interview: MessageSquareText,
  find_jobs: Briefcase,
}

function CategoryChip({ category }: { category: ReviewCategory }) {
  return (
    <div className="card p-4 flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-(--color-ink-dim)">{category.label}</span>
        {category.priority !== 'none' && category.available && (
          <span
            className="text-[9px] font-mono uppercase tracking-wide shrink-0"
            style={{ color: PRIORITY_COLOR[category.priority] }}
          >
            {PRIORITY_LABEL[category.priority]}
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-1.5">
        {category.available ? (
          <>
            <span
              className="font-display text-2xl tabular-nums leading-none"
              style={{ color: bandColor(category.band) }}
            >
              {Math.round(category.score as number)}
            </span>
            <span className="text-[10px] font-mono text-(--color-ink-faint)">/100</span>
            <span className="text-[10px] text-(--color-ink-faint)">{bandLabel(category.band)}</span>
          </>
        ) : (
          <span className="text-xs text-(--color-ink-faint)">Not yet available</span>
        )}
      </div>
    </div>
  )
}

function RecommendationCard({ category }: { category: ReviewCategory }) {
  const [expanded, setExpanded] = useState(category.priority === 'high')

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 p-4 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{ background: PRIORITY_COLOR[category.priority] }}
            aria-hidden="true"
          />
          <span className="text-sm font-medium text-(--color-ink) truncate">{category.label}</span>
        </div>
        {/* Everything that must never truncate lives in this second zone,
            so a long label never pushes the score or priority off screen —
            three items under one justify-between would instead have
            floated the middle one to the midpoint, nowhere near the label
            it describes. */}
        <div className="flex items-center gap-3 shrink-0">
          {category.available && (
            <span className="text-xs font-mono tabular-nums text-(--color-ink-faint)">
              {Math.round(category.score as number)}/100
            </span>
          )}
          {/* The dot above is decorative — this is what actually says so,
              matching CategoryChip's convention of stating priority as text
              rather than leaving it to colour alone. */}
          {category.priority !== 'none' && category.available && (
            <span
              className="text-[9px] font-mono uppercase tracking-wide"
              style={{ color: PRIORITY_COLOR[category.priority] }}
            >
              {PRIORITY_LABEL[category.priority]}
            </span>
          )}
          <ChevronDown
            strokeWidth={1.5}
            className="h-4 w-4 text-(--color-ink-faint) transition-transform"
            style={{ transform: expanded ? 'rotate(180deg)' : 'none' }}
            aria-hidden="true"
          />
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 flex flex-col gap-3 border-t border-(--color-canvas-line) pt-3">
              <div>
                <div className="eyebrow text-[10px] mb-1">What this measures</div>
                <p className="text-xs leading-relaxed text-(--color-ink-dim)">{category.explanation}</p>
              </div>
              <div>
                <div className="eyebrow text-[10px] mb-1">Based on your resume</div>
                <p className="text-xs leading-relaxed text-(--color-ink-subtle)">{category.reason}</p>
              </div>
              {category.improvements.length > 0 && (
                <div>
                  <div className="eyebrow text-[10px] mb-1.5 flex items-center gap-1.5">
                    <Lightbulb strokeWidth={1.5} className="h-3 w-3" aria-hidden="true" />
                    What to do
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {category.improvements.map((tip) => (
                      <li key={tip} className="text-xs leading-relaxed text-(--color-ink-subtle) flex items-start gap-2">
                        <span className="text-(--color-ink-faint) shrink-0">—</span>
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

type PanelTab = 'overview' | 'recommendations'

/**
 * The Resume Review section — Overview (glanceable scores), Recommendations
 * (why each score is what it is, and what to do about it), and Next Actions.
 *
 * Deliberately doesn't re-render missing skills, missing keywords, or
 * weak-bullet detail: the tabs and ResumeQualityPanel already shown on this
 * page cover that ground from the same underlying analysers. This adds the
 * two things nothing on the page shows yet — a named score per dimension,
 * and the reasoning behind each one — rather than a second copy of the first.
 *
 * The original scan's free-text `suggestions` are folded into the
 * Recommendations tab rather than kept on their own tab — both were
 * improvement advice one tab apart from each other, so the fix was moving
 * one into the other, not building a third home for either.
 *
 * "What recruiters expect" and a rewritten "example improvement" per
 * recommendation are not rendered because the API doesn't return them yet —
 * Phase 1 is deterministic, no LLM call. `explanation` and `reason` are the
 * two fields that exist; showing a fabricated third and fourth would be
 * inventing content the backend doesn't back.
 */
export function ResumeReviewPanel({ analysisId, suggestions }: ResumeReviewPanelProps) {
  const [review, setReview] = useState<ResumeReview | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<PanelTab>('overview')

  // No setLoading(true) here: useState(true) already covers the initial
  // fetch, and the mount site keys this component on the analysis id, so a
  // new scan remounts with fresh state rather than reusing stale state.
  useEffect(() => {
    let cancelled = false
    getResumeReview(analysisId)
      .then((data) => {
        if (!cancelled) setReview(data)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the resume review.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [analysisId])

  if (loading) {
    return (
      <div className="card space-y-4 p-6">
        <Skeleton className="h-3 w-32" />
        <div className="flex gap-6">
          <Skeleton className="h-28 w-28 rounded-full shrink-0" />
          <div className="flex-1 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error || !review) {
    return (
      <div className="card p-6">
        <InlineError message={error || 'No review available.'} />
      </div>
    )
  }

  const { resume_health, job_match, categories, next_actions } = review
  const sortedForRecommendations = [...categories].sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2, none: 3 }
    return rank[a.priority] - rank[b.priority]
  })

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="eyebrow mb-1">Resume Review</div>
        <p className="text-xs leading-relaxed text-(--color-ink-dim)">
          {review.mode === 'job_specific'
            ? 'Resume Health measures the document itself, independent of this posting. Job Match is how well it fits this one.'
            : 'Resume Health measures the document itself. Add a job description to also see Job Match.'}
        </p>
      </div>

      <Tabs.Root value={tab} onValueChange={(v) => setTab(v as PanelTab)}>
        <Tabs.List className="flex items-center gap-5 mb-4 border-b border-(--color-canvas-line)">
          <Tabs.Trigger
            value="overview"
            className="flex items-center gap-2 pb-3 eyebrow text-(--color-ink-faint) border-b-2 border-transparent data-[state=active]:text-(--color-ink) data-[state=active]:border-(--color-accent) transition-colors"
          >
            <TrendingUp strokeWidth={1.5} className="w-3.5 h-3.5" aria-hidden="true" />
            Overview
          </Tabs.Trigger>
          <Tabs.Trigger
            value="recommendations"
            className="flex items-center gap-2 pb-3 eyebrow text-(--color-ink-faint) border-b-2 border-transparent data-[state=active]:text-(--color-ink) data-[state=active]:border-(--color-accent) transition-colors"
          >
            <Lightbulb strokeWidth={1.5} className="w-3.5 h-3.5" aria-hidden="true" />
            Recommendations
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="overview" forceMount className="data-[state=inactive]:hidden">
          <div className="card p-6">
            <div className="flex flex-wrap items-center gap-8 mb-6">
              <ScoreRing
                value={resume_health.score ?? 0}
                label="Resume Health"
                size={148}
              />
              {job_match && (
                <>
                  <div className="hidden sm:block w-px self-stretch bg-(--color-canvas-line)" aria-hidden="true" />
                  <ScoreRing
                    value={job_match.score}
                    label="Job Match"
                    size={148}
                  />
                </>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {categories.map((category) => (
                <CategoryChip key={category.key} category={category} />
              ))}
            </div>

            {resume_health.skipped.length > 0 && (
              <p className="mt-4 text-[10px] font-mono text-(--color-ink-faint)">
                Not scored: {resume_health.skipped.join(', ')} — the inputs for these checks weren&apos;t available.
              </p>
            )}
          </div>
        </Tabs.Content>

        <Tabs.Content value="recommendations" forceMount className="data-[state=inactive]:hidden">
          <div className="flex flex-col gap-2.5">
            {sortedForRecommendations.map((category) => (
              <RecommendationCard key={category.key} category={category} />
            ))}
            {suggestions.length > 0 && (
              <div className="card p-4">
                <div className="eyebrow text-[10px] mb-2.5">General suggestions</div>
                <ol className="space-y-3">
                  {suggestions.map((s, i) => (
                    <li key={i} className="flex items-start gap-3 text-xs leading-relaxed text-(--color-ink-subtle)">
                      <span className="font-mono text-[10px] text-(--color-ink-faint) shrink-0 pt-0.5">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      {s}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </Tabs.Content>
      </Tabs.Root>

      {next_actions.length > 0 && (
        <div>
          <div className="eyebrow mb-3 flex items-center gap-2">
            <Target strokeWidth={1.5} className="w-3.5 h-3.5" aria-hidden="true" />
            Next actions
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {next_actions.map((action) => (
              <NextActionCard key={action.key} action={action} icon={ACTION_ICON[action.key]} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
