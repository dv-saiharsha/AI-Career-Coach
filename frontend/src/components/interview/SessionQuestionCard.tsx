'use client'

/**
 * One question in a running mock-interview session: the prompt, the user's
 * submitted answer and its per-dimension feedback, and the model answer.
 *
 * Distinct from PrepQuestionCard, which is the *study* surface in Interview
 * Preparation — this one belongs to a live scored session.
 */

import { forwardRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react'
import { DIMENSION_LABELS } from '@/lib/apiClient'
import { EASE_OUT as EASE } from '@/lib/motion'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'
import { Button } from '@/components/ui/button'
import { ModelAnswerPanel } from './ModelAnswerPanel'
import { BulletList, scoreColor, type ModelAnswerState, type SessionQuestion } from './interviewShared'

export const QuestionCard = forwardRef<HTMLDivElement, {
  question: SessionQuestion
  index: number
  tag: string
  isActive: boolean
  modelAnswer: ModelAnswerState | undefined
  onRetryModelAnswer: () => void
  onSelect: () => void
  onNext: () => void
  onExit: () => void
}>(function QuestionCard({ question, index, tag, isActive, modelAnswer, onRetryModelAnswer, onSelect, onNext, onExit }, ref) {
  const [showImproved, setShowImproved] = useState(false)
  const reduceMotion = usePrefersReducedMotion()

  return (
    <div
      ref={ref}
      className="card overflow-hidden transition-colors"
      style={{ borderColor: isActive && question.status !== 'answered' ? 'var(--color-accent)' : 'var(--color-canvas-line)' }}
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-2">
          <span className="eyebrow text-[11px]">
            QUESTION {String(index).padStart(2, '0')} — {tag}
          </span>
          {question.status === 'answered' && <CheckCircle2 strokeWidth={1.5} className="w-4 h-4 text-(--color-signal-high) shrink-0" />}
        </div>
        <p className="text-base text-(--color-ink) leading-relaxed">{question.text}</p>

        {question.status === 'unanswered' && !isActive && (
          <Button type="button" variant="ghost" size="sm" onClick={onSelect} className="mt-4">
            Answer this question
          </Button>
        )}

        {/* Always available — learn the ideal answer without having to attempt first */}
        {question.status !== 'answered' && (
          <ModelAnswerPanel modelAnswer={modelAnswer} onRetry={onRetryModelAnswer} />
        )}

        {question.feedbackError && (
          <div className="mt-3 text-xs text-(--color-error)">{question.feedbackError}</div>
        )}
      </div>

      {question.submittedAnswer && (
        <div className="border-t border-(--color-canvas-line) p-5 pt-4" style={{ background: 'var(--color-canvas)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="eyebrow text-[10px]">Your answer</span>
            {question.submittedAt && (
              <span className="text-[10px] font-mono text-(--color-ink-faint)">
                {new Date(question.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
          <p className="text-sm text-(--color-ink-subtle) leading-relaxed whitespace-pre-line">{question.submittedAnswer}</p>

          {question.status === 'evaluating' && (
            <div className="relative mt-4 pt-3">
              <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-(--color-canvas-line) overflow-hidden">
                <motion.div
                  className="h-full w-1/3 bg-(--color-accent)"
                  animate={{ x: ['-100%', '300%'] }}
                  transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }}
                />
              </div>
              <span className="eyebrow text-[10px] text-(--color-ink-dim)">Evaluating</span>
            </div>
          )}

          {question.status === 'answered' && question.feedback && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: EASE }}
              className="mt-4 pt-4 border-t border-(--color-canvas-line)"
            >
              <span className="eyebrow text-[10px] mb-3 block">Feedback — Question {String(index).padStart(2, '0')}</span>

              <div className="flex items-center gap-3 mb-4">
                <span className="text-xs text-(--color-ink-dim) w-10 shrink-0">Score</span>
                <div className="flex-1 h-1 rounded-full bg-(--color-canvas-line) overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: scoreColor(question.feedback.score) }}
                    initial={{ width: reduceMotion ? `${(question.feedback.score / 10) * 100}%` : 0 }}
                    animate={{ width: `${(question.feedback.score / 10) * 100}%` }}
                    transition={reduceMotion ? { duration: 0 } : { duration: 0.6, ease: EASE }}
                  />
                </div>
                <span className="text-xs font-mono tabular-nums shrink-0" style={{ color: scoreColor(question.feedback.score) }}>
                  {question.feedback.score.toFixed(1)} / 10
                </span>
              </div>

              {Object.keys(question.feedback.dimension_scores).length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 mb-4 pb-4 border-b border-(--color-canvas-line)">
                  {Object.entries(DIMENSION_LABELS).map(([key, label]) => {
                    const dimScore = question.feedback?.dimension_scores[key]
                    if (dimScore === undefined) return null
                    return (
                      <div key={key} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-(--color-ink-faint)">{label}</span>
                        <span className="font-mono tabular-nums" style={{ color: scoreColor(dimScore) }}>{dimScore.toFixed(1)}</span>
                      </div>
                    )
                  })}
                </div>
              )}

              {question.feedback.voice_metrics && Object.values(question.feedback.voice_metrics).some(v => v != null) && (
                <div className="mb-4 pb-4 border-b border-(--color-canvas-line)">
                  <span className="eyebrow text-[10px] mb-1.5 block">Voice observations</span>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-(--color-ink-dim)">
                    {question.feedback.voice_metrics.speaking_duration_seconds != null && (
                      <span>
                        Duration: {Math.floor(question.feedback.voice_metrics.speaking_duration_seconds / 60)}:
                        {String(Math.round(question.feedback.voice_metrics.speaking_duration_seconds % 60)).padStart(2, '0')}
                      </span>
                    )}
                    {question.feedback.voice_metrics.speaking_rate_wpm != null && (
                      <span>Pace: {Math.round(question.feedback.voice_metrics.speaking_rate_wpm)} wpm</span>
                    )}
                    {question.feedback.voice_metrics.long_pause_count != null && (
                      <span>Long pauses: {question.feedback.voice_metrics.long_pause_count}</span>
                    )}
                    {question.feedback.voice_metrics.filler_word_count != null && (
                      <span>Filler words: {question.feedback.voice_metrics.filler_word_count}</span>
                    )}
                    {question.feedback.voice_metrics.average_confidence != null && (
                      <span>Transcription confidence: {Math.round(question.feedback.voice_metrics.average_confidence * 100)}%</span>
                    )}
                  </div>
                </div>
              )}

              {question.feedback.strengths.length > 0 && (
                <div className="mb-4">
                  <span className="eyebrow text-[10px] mb-1.5 block">Strengths</span>
                  <BulletList items={question.feedback.strengths} />
                </div>
              )}

              {question.feedback.weaknesses.length > 0 && (
                <div className="mb-4">
                  <span className="eyebrow text-[10px] mb-1.5 block">Weaknesses</span>
                  <BulletList items={question.feedback.weaknesses} />
                </div>
              )}

              {question.feedback.missing_points.length > 0 && (
                <div className="mb-4">
                  <span className="eyebrow text-[10px] mb-1.5 block">Missing points</span>
                  <BulletList items={question.feedback.missing_points} />
                </div>
              )}

              {question.feedback.learning_suggestions.length > 0 && (
                <div className="mb-4">
                  <span className="eyebrow text-[10px] mb-1.5 block">Learning suggestions</span>
                  <BulletList items={question.feedback.learning_suggestions} />
                </div>
              )}

              {question.feedback.sample_answer && (
                <div className="mb-4">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowImproved(v => !v)}
                    aria-expanded={showImproved}
                    className="h-auto gap-1.5 px-0 font-mono text-xs uppercase tracking-widest text-ink-dim hover:bg-transparent hover:text-ink"
                  >
                    <motion.span animate={{ rotate: showImproved ? 90 : 0 }} transition={{ duration: 0.15 }}>
                      <ChevronRight strokeWidth={1.5} className="w-3.5 h-3.5" />
                    </motion.span>
                    View improved answer
                  </Button>
                  <AnimatePresence initial={false}>
                    {showImproved && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.15 }}
                        className="overflow-hidden"
                      >
                        <p
                          className="text-sm text-(--color-ink-dim) leading-relaxed mt-3 pl-3.5 py-0.5"
                          style={{ borderLeft: '4px solid var(--color-accent)', background: 'var(--color-canvas)' }}
                        >
                          {question.feedback.sample_answer}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              <div className="flex items-center gap-3">
                <Button type="button" size="sm" onClick={onNext}>
                  Next question
                  <ChevronDown strokeWidth={1.5} className="-rotate-90" />
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={onExit}>
                  Exit interview
                </Button>
              </div>
            </motion.div>
          )}
        </div>
      )}
    </div>
  )
})

/* ─── Session Report ─────────────────────────────────────────── */
