'use client'

/**
 * End-of-session evaluation: overall readiness plus a per-question breakdown
 * of delivery, technical accuracy and structural clarity.
 *
 * Previously `SessionReportPanel` + `ReportQuestionRow`, both defined inline
 * in interview/page.tsx. Behaviour unchanged; only the panel's exported name
 * differs.
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, RotateCcw, Sparkles, Target, TrendingUp } from 'lucide-react'
import type { SessionReport } from '@/lib/apiClient'
import { bandColor, bandLabel } from '@/lib/scoreBands'
import { categoryLabel } from '@/lib/interviewCategories'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'
import { EASE_OUT as EASE } from '@/lib/motion'
import { NextActionCard } from '@/components/NextActionCard'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { InlineError } from '@/components/resume/InlineError'
import { BulletList, scoreColor } from './interviewShared'

const ACTION_ICON: Record<string, typeof Sparkles> = {
  continue_prep: Sparkles,
  practice_category: Target,
  review_resume: TrendingUp,
  retry_mock: RotateCcw,
}

function ReportQuestionRow({ item }: { item: import('@/lib/apiClient').QuestionFeedback }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="border border-(--color-canvas-line) rounded-[10px] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 p-3 text-left"
      >
        <ChevronDown
          strokeWidth={1.5}
          className="h-3.5 w-3.5 shrink-0 text-(--color-ink-faint) transition-transform"
          style={{ transform: expanded ? 'rotate(180deg)' : 'none' }}
        />
        <span className="flex-1 min-w-0 text-sm text-(--color-ink) truncate">{item.question_text}</span>
        <span className="text-xs font-mono shrink-0" style={{ color: scoreColor(item.score) }}>{item.score.toFixed(1)}/10</span>
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
            <div className="p-4 pt-0 space-y-3 border-t border-(--color-canvas-line) mt-0">
              <p className="text-xs text-(--color-ink-subtle) leading-relaxed pt-3 whitespace-pre-line">{item.answer_text}</p>
              {item.strengths.length > 0 && (
                <div><span className="eyebrow text-[10px] mb-1 block">Strengths</span><BulletList items={item.strengths} /></div>
              )}
              {item.weaknesses.length > 0 && (
                <div><span className="eyebrow text-[10px] mb-1 block">Weaknesses</span><BulletList items={item.weaknesses} /></div>
              )}
              {item.missing_points.length > 0 && (
                <div><span className="eyebrow text-[10px] mb-1 block">Missing points</span><BulletList items={item.missing_points} /></div>
              )}
              {item.learning_suggestions.length > 0 && (
                <div><span className="eyebrow text-[10px] mb-1 block">Learning suggestions</span><BulletList items={item.learning_suggestions} /></div>
              )}
              {item.sample_answer && (
                <div>
                  <span className="eyebrow text-[10px] mb-1 block">Improved answer</span>
                  <p className="text-xs text-(--color-ink-dim) leading-relaxed pl-3" style={{ borderLeft: '3px solid var(--color-accent)' }}>
                    {item.sample_answer}
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function InterviewFeedbackPanel({
  report,
  loading,
  error,
  onRetry,
  onRestart,
  onExit,
  restarting,
}: {
  report: SessionReport | null
  loading: boolean
  error: string
  onRetry: () => void
  onRestart: () => void
  onExit: () => void
  restarting: boolean
}) {
  const reduceMotion = usePrefersReducedMotion()

  if (loading || (!report && !error)) {
    return (
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-40" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    )
  }

  if (error || !report) {
    return (
      <div>
        <InlineError message={error || 'Could not load your interview report.'} />
        <Button type="button" variant="ghost" size="sm" onClick={onRetry} className="mt-3">
          Retry
        </Button>
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
      className="space-y-6"
    >
      <div className="card p-8 text-center">
        <span className="eyebrow mb-3 inline-flex">
          {report.role} · {report.seniority} · {categoryLabel(report.category)}
        </span>
        <h2 className="text-2xl font-display font-medium text-(--color-ink) mb-2">Interview complete</h2>

        <div className="flex items-center justify-center gap-3 max-w-xs mx-auto mb-3">
          <span className="text-xs text-(--color-ink-dim) w-24 shrink-0 text-left">Overall score</span>
          <div className="flex-1 h-1 rounded-full bg-(--color-canvas-line) overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ background: scoreColor(report.overall_score) }}
              initial={{ width: reduceMotion ? `${(report.overall_score / 10) * 100}%` : 0 }}
              animate={{ width: `${(report.overall_score / 10) * 100}%` }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.6, ease: EASE }}
            />
          </div>
          <span className="text-xs font-mono tabular-nums shrink-0" style={{ color: scoreColor(report.overall_score) }}>
            {report.overall_score.toFixed(1)} / 10
          </span>
        </div>

        <span
          className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded-full border mb-5"
          style={{ borderColor: bandColor(report.readiness_band), color: bandColor(report.readiness_band) }}
        >
          Readiness: {bandLabel(report.readiness_band)}
        </span>

        <p className="text-sm text-(--color-ink-dim) leading-relaxed max-w-lg mx-auto">{report.performance_summary}</p>
      </div>

      {report.category_performance.length > 0 && (
        <div className="card p-6">
          <span className="eyebrow mb-4 block">Performance by dimension</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
            {report.category_performance.map(dim => (
              <div key={dim.key} className="flex items-center gap-3">
                <span className="text-xs text-(--color-ink-dim) w-32 shrink-0">{dim.label}</span>
                <div className="flex-1 h-1 rounded-full bg-(--color-canvas-line) overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${(dim.average_score / 10) * 100}%`, background: scoreColor(dim.average_score) }} />
                </div>
                <span className="text-xs font-mono tabular-nums shrink-0" style={{ color: scoreColor(dim.average_score) }}>
                  {dim.average_score.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {report.strongest_skills.length > 0 && (
          <div className="card p-5">
            <span className="eyebrow mb-2 block">Strongest skills</span>
            <div className="flex flex-wrap gap-1.5">
              {report.strongest_skills.map(s => <span key={s} className="chip" style={{ borderColor: 'var(--color-ok)', color: 'var(--color-ok)' }}>{s}</span>)}
            </div>
          </div>
        )}
        {report.weakest_skills.length > 0 && (
          <div className="card p-5">
            <span className="eyebrow mb-2 block">Weakest skills</span>
            <div className="flex flex-wrap gap-1.5">
              {report.weakest_skills.map(s => <span key={s} className="chip" style={{ borderColor: 'var(--color-warn)', color: 'var(--color-warn)' }}>{s}</span>)}
            </div>
          </div>
        )}
      </div>

      {report.topics_to_improve.length > 0 && (
        <div className="card p-5">
          <span className="eyebrow mb-2 block">Topics to improve</span>
          <BulletList items={report.topics_to_improve} />
        </div>
      )}

      {report.practice_plan.length > 0 && (
        <div className="card p-5">
          <span className="eyebrow mb-2 block">Practice plan</span>
          <ol className="space-y-1.5">
            {report.practice_plan.map((step, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-(--color-ink-subtle) leading-relaxed">
                <span className="font-mono text-[10px] text-(--color-ink-faint) shrink-0 mt-0.5">{String(i + 1).padStart(2, '0')}</span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      )}

      {report.next_actions.length > 0 && (
        <div>
          <span className="eyebrow mb-3 block">Next recommended actions</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {report.next_actions.map(action => <NextActionCard key={action.key} action={action} icon={ACTION_ICON[action.key]} />)}
          </div>
        </div>
      )}

      {report.question_feedback.length > 0 && (
        <div>
          <span className="eyebrow mb-3 block">Question-by-question feedback</span>
          <div className="space-y-2">
            {report.question_feedback.map(item => <ReportQuestionRow key={item.question_id} item={item} />)}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button type="button" onClick={onRestart} disabled={restarting}>
          <RotateCcw strokeWidth={1.5} />
          {restarting ? 'Restarting…' : 'Practice mock interview again'}
        </Button>
        <Button type="button" variant="ghost" onClick={onExit}>
          Exit interview
        </Button>
      </div>
    </motion.div>
  )
}
