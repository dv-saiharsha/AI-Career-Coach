/**
 * Small pieces shared by the interview panels.
 *
 * Extracted alongside ModelAnswerPanel / InterviewFeedbackPanel when the
 * 1,331-line interview page was split up: both of those and the report row
 * use these, so leaving them in the page would have meant the page importing
 * back from its own children. Mirrors the existing resume/scanShared.ts.
 */

import type {
  InterviewFeedback,
  InterviewQuestion,
  ModelAnswer,
} from '@/lib/apiClient'

/**
 * Score-to-signal mapping for a 0–10 answer score.
 *
 * Separate from lib/scoreBands.ts on purpose: that owns the 0–100 ATS/resume
 * band vocabulary (WEAK … EXCELLENT), which is a different scale with
 * different thresholds. Collapsing them would make one of the two lie.
 */
export function scoreColor(score: number): string {
  if (score >= 7) return 'var(--color-signal-high)'
  if (score >= 4) return 'var(--color-signal-mid)'
  return 'var(--color-signal-low)'
}

/* Session state shared between the page (which owns it) and the panels
   (which render it). */
export type QuestionStatus = 'unanswered' | 'evaluating' | 'answered'

export interface SessionQuestion extends InterviewQuestion {
  status: QuestionStatus
  submittedAnswer: string | null
  submittedAt: string | null
  feedback: InterviewFeedback | null
  feedbackError: string | null
}

export interface ModelAnswerState {
  status: 'loading' | 'ready' | 'error'
  data: ModelAnswer | null
}

export function BulletList({ items }: { items: string[] }) {
  if (items.length === 0) return null
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-(--color-ink-subtle) leading-relaxed">
          <span className="text-(--color-ink-faint) shrink-0">—</span>
          {item}
        </li>
      ))}
    </ul>
  )
}
