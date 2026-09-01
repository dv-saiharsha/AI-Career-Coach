'use client'

import { useState } from 'react'
import {
  Bookmark, Check, ChevronDown, Clock, Lightbulb, MessageCircleQuestion,
  Sparkles, Target, TriangleAlert,
} from 'lucide-react'
import { updatePrepQuestionState, type PrepDifficulty, type PrepQuestion } from '@/lib/apiClient'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

const DIFFICULTY_STYLE: Record<PrepDifficulty, string> = {
  easy: 'text-(--color-ok) border-(--color-ok)/25 bg-(--color-ok)/5',
  medium: 'text-(--color-warn) border-(--color-warn)/25 bg-(--color-warn)/5',
  hard: 'text-(--color-err) border-(--color-err)/25 bg-(--color-err)/5',
}

function Section({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Sparkles
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="eyebrow text-[10px] mb-1.5 flex items-center gap-1.5">
        <Icon strokeWidth={1.5} className="h-3 w-3" aria-hidden="true" />
        {label}
      </div>
      {children}
    </div>
  )
}

function BulletList({ items }: { items: string[] }) {
  if (items.length === 0) return null
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2 text-xs leading-relaxed text-(--color-ink-subtle)">
          <span className="text-(--color-ink-faint) shrink-0">—</span>
          {item}
        </li>
      ))}
    </ul>
  )
}

/**
 * One prep question — collapsed to a scannable row, expanded to everything
 * needed to actually learn from it. Nothing here is gated behind an
 * attempt: this is not a test, so the full content is available the moment
 * the card opens, matching the same collapse/expand interaction Resume
 * Review already established (RecommendationCard) rather than inventing a
 * new one.
 */
interface PrepQuestionCardProps {
  question: PrepQuestion
  /** Called after a successful save so a parent tracking aggregate state
   *  (e.g. "N of M marked complete") stays in sync — this card's own state
   *  is otherwise local and the parent would never find out it changed. */
  onStateChange?: (state: PrepQuestion['user_state']) => void
}

export function PrepQuestionCard({ question, onStateChange }: PrepQuestionCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [state, setState] = useState(
    question.user_state ?? { bookmarked: false, completed: false, notes: null },
  )
  const [notesDraft, setNotesDraft] = useState(state.notes ?? '')
  const [savingNotes, setSavingNotes] = useState(false)

  // Optimistic: the toggle should feel instant. A failure reverts rather
  // than leaving the UI claiming a state the server never saved.
  const toggle = async (field: 'bookmarked' | 'completed') => {
    const next = { ...state, [field]: !state[field] }
    setState(next)
    onStateChange?.(next)
    try {
      await updatePrepQuestionState(question.id, { [field]: next[field] })
    } catch {
      setState(state)
      onStateChange?.(state)
    }
  }

  const saveNotes = async () => {
    if (notesDraft === (state.notes ?? '')) return
    setSavingNotes(true)
    try {
      await updatePrepQuestionState(question.id, { notes: notesDraft || null })
      const next = { ...state, notes: notesDraft || null }
      setState(next)
      onStateChange?.(next)
    } catch {
      // Left in the textarea so nothing typed is lost — the user can retry
      // by triggering another blur, e.g. tabbing away again.
    } finally {
      setSavingNotes(false)
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex w-full items-start gap-3 p-4">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex flex-1 items-start gap-3 text-left min-w-0"
        >
          <ChevronDown
            strokeWidth={1.5}
            className="h-4 w-4 mt-0.5 shrink-0 text-(--color-ink-faint) transition-transform"
            style={{ transform: expanded ? 'rotate(180deg)' : 'none' }}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <span className={`text-[9px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded-full border ${DIFFICULTY_STYLE[question.difficulty]}`}>
                {question.difficulty}
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] text-(--color-ink-faint)">
                <Clock strokeWidth={1.5} className="h-3 w-3" aria-hidden="true" />
                {question.estimated_answer_time}
              </span>
              {state.completed && (
                <span className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wide text-(--color-ok)">
                  <Check strokeWidth={2} className="h-3 w-3" aria-hidden="true" />
                  Completed
                </span>
              )}
            </div>
            <p className="text-sm font-medium text-(--color-ink) leading-snug">{question.text}</p>
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-pressed={state.bookmarked}
            aria-label={state.bookmarked ? 'Remove bookmark' : 'Bookmark this question'}
            onClick={() => toggle('bookmarked')}
          >
            <Bookmark
              strokeWidth={1.5}
              className="h-4 w-4"
              style={{ fill: state.bookmarked ? 'var(--color-accent)' : 'none', color: 'var(--color-accent)' }}
            />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-pressed={state.completed}
            aria-label={state.completed ? 'Mark as not completed' : 'Mark as completed'}
            onClick={() => toggle('completed')}
          >
            <Check
              strokeWidth={2}
              className="h-4 w-4"
              style={{ color: state.completed ? 'var(--color-ok)' : 'var(--color-ink-faint)' }}
            />
          </Button>
        </div>
      </div>

        {expanded && (
          <div
           
           
           
           
            className="overflow-hidden panel-enter"
          >
            <div className="flex flex-col gap-4 px-4 pb-4 pt-1 border-t border-(--color-canvas-line)">
              <Section icon={Target} label="What the interviewer is testing">
                <p className="text-xs leading-relaxed text-(--color-ink-subtle)">{question.interviewer_intent}</p>
              </Section>

              <Section icon={Sparkles} label="Ideal answer">
                <p className="text-xs leading-relaxed text-(--color-ink-subtle)">{question.ideal_answer}</p>
              </Section>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Section icon={Lightbulb} label="Concept explanation">
                  <p className="text-xs leading-relaxed text-(--color-ink-subtle)">{question.concept_explanation}</p>
                </Section>
                <Section icon={Lightbulb} label="In simple terms">
                  <p className="text-xs leading-relaxed text-(--color-ink-subtle)">{question.beginner_explanation}</p>
                </Section>
              </div>

              <Section icon={MessageCircleQuestion} label="Real-world example">
                <p className="text-xs leading-relaxed text-(--color-ink-subtle)">{question.real_world_example}</p>
              </Section>

              {question.interview_tips.length > 0 && (
                <Section icon={Lightbulb} label="Interview tips">
                  <BulletList items={question.interview_tips} />
                </Section>
              )}

              {question.common_mistakes.length > 0 && (
                <Section icon={TriangleAlert} label="Common mistakes">
                  <BulletList items={question.common_mistakes} />
                </Section>
              )}

              {question.important_keywords.length > 0 && (
                <Section icon={Sparkles} label="Important keywords">
                  <div className="flex flex-wrap gap-1.5">
                    {question.important_keywords.map((keyword) => (
                      <span key={keyword} className="chip">{keyword}</span>
                    ))}
                  </div>
                </Section>
              )}

              {question.follow_up_questions.length > 0 && (
                <Section icon={MessageCircleQuestion} label="Follow-up questions to expect">
                  <BulletList items={question.follow_up_questions} />
                </Section>
              )}

              <div className="border-t border-(--color-canvas-line) pt-4">
                <label htmlFor={`notes-${question.id}`} className="eyebrow text-[10px] mb-1.5 block">
                  Your notes
                </label>
                <Textarea
                  id={`notes-${question.id}`}
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  onBlur={saveNotes}
                  placeholder="Jot down anything you want to remember about this one…"
                  rows={2}
                />
                {savingNotes && <p className="mt-1 text-[10px] text-(--color-ink-faint)">Saving…</p>}
              </div>
            </div>
          </div>
        )}
    </div>
  )
}
