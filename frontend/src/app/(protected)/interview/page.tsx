'use client'

import { forwardRef, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BookOpen, Layers, Globe, CheckCircle2, RotateCcw,
  ChevronDown, ChevronRight, Lightbulb, Sparkles,
} from 'lucide-react'
import {
  generateInterviewQuestions,
  evaluateInterviewAnswer,
  getInterviewModelAnswer,
  type InterviewQuestion,
  type InterviewFeedback,
  type ModelAnswer,
} from '../../../lib/apiClient'
import { usePrefersReducedMotion } from '../../../lib/usePrefersReducedMotion'

const EASE = [0.22, 1, 0.36, 1] as const

type Category = 'fundamentals' | 'system_design' | 'real_world'
type QuestionStatus = 'unanswered' | 'evaluating' | 'answered'

interface SessionQuestion extends InterviewQuestion {
  category: Category
  status: QuestionStatus
  submittedAnswer: string | null
  submittedAt: string | null
  feedback: InterviewFeedback | null
  feedbackError: string | null
}

interface ModelAnswerState {
  status: 'loading' | 'ready' | 'error'
  data: ModelAnswer | null
}

const CATS: Record<Category, { label: string; icon: typeof BookOpen; tag: 'TECHNICAL' | 'BEHAVIORAL' }> = {
  fundamentals: { label: 'Fundamentals', icon: BookOpen, tag: 'TECHNICAL' },
  system_design: { label: 'System Design', icon: Layers, tag: 'TECHNICAL' },
  real_world: { label: 'Real-World Scenarios', icon: Globe, tag: 'BEHAVIORAL' },
}

function categorize(type: string): Category {
  const t = type.toLowerCase()
  if (t.includes('system') || t.includes('design') || t.includes('arch') || t.includes('scale') || t.includes('infra')) return 'system_design'
  if (t.includes('real') || t.includes('scenario') || t.includes('case') || t.includes('behav') || t.includes('situational')) return 'real_world'
  return 'fundamentals'
}

const SENIORITIES = ['Junior', 'Mid-level', 'Senior', 'Staff']

const ROLE_PRESETS = [
  { key: 'data-scientist', label: 'Data Scientist', family: 'ENGINEERING', desc: 'Statistics, experimentation, and turning data into decisions.' },
  { key: 'ml-engineer', label: 'ML Engineer', family: 'ENGINEERING', desc: 'Productionizing models — training, serving, and scale.' },
  { key: 'ai-engineer', label: 'AI Engineer', family: 'ENGINEERING', desc: 'LLM-powered products, prompting, and applied AI systems.' },
  { key: 'product-manager', label: 'Product Manager', family: 'PRODUCT', desc: 'Roadmaps, tradeoffs, and shipping the right thing.' },
  { key: 'sre', label: 'Site Reliability Engineer', family: 'OPERATIONS', desc: 'Reliability, incident response, and systems at scale.' },
] as const

function scoreColor(score: number): string {
  if (score >= 7) return 'var(--color-signal-high)'
  if (score >= 4) return 'var(--color-signal-mid)'
  return 'var(--color-signal-low)'
}

export default function InterviewCoach() {
  const reduceMotion = usePrefersReducedMotion()

  // ── Setup state ──────────────────────────────────────────────
  const [selectedRoleKey, setSelectedRoleKey] = useState<string | 'custom' | null>(null)
  const [customRole, setCustomRole] = useState('')
  const [seniority, setSeniority] = useState('Mid-level')
  const [setupLoading, setSetupLoading] = useState(false)
  const [setupError, setSetupError] = useState('')

  // ── Session state ────────────────────────────────────────────
  const [role, setRole] = useState('')
  const [questions, setQuestions] = useState<SessionQuestion[]>([])
  // Model answers are prefetched when the session starts so "Show me the
  // answer" reveals instantly instead of triggering a fetch on click.
  const [modelAnswers, setModelAnswers] = useState<Record<number, ModelAnswerState>>({})
  const [activeTab, setActiveTab] = useState<Category>('fundamentals')
  const [activeQuestionId, setActiveQuestionId] = useState<number | null>(null)
  const [answerDraft, setAnswerDraft] = useState('')
  const [submitError, setSubmitError] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const questionRefs = useRef<Record<number, HTMLDivElement | null>>({})

  const resolvedRole = selectedRoleKey === 'custom' ? customRole.trim() : ROLE_PRESETS.find(r => r.key === selectedRoleKey)?.label ?? ''

  const byCategory = (cat: Category) => questions.filter(q => q.category === cat)
  const answeredCount = questions.filter(q => q.status === 'answered').length
  const allAnswered = questions.length > 0 && answeredCount === questions.length
  const activeQuestion = questions.find(q => q.id === activeQuestionId) ?? null

  useEffect(() => {
    if (activeQuestionId == null) return
    const node = questionRefs.current[activeQuestionId]
    node?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' })
  }, [activeQuestionId, reduceMotion])

  const selectQuestion = (id: number | null) => {
    setAnswerDraft('')
    setActiveQuestionId(id)
  }

  useEffect(() => {
    // Auto-grow the composer, capped by CSS max-height (see className below)
    const node = textareaRef.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${node.scrollHeight}px`
  }, [answerDraft])

  const prefetchModelAnswer = async (questionId: number) => {
    setModelAnswers(prev => ({ ...prev, [questionId]: { status: 'loading', data: null } }))
    try {
      const data = await getInterviewModelAnswer(questionId)
      setModelAnswers(prev => ({ ...prev, [questionId]: { status: 'ready', data } }))
    } catch {
      setModelAnswers(prev => ({ ...prev, [questionId]: { status: 'error', data: null } }))
    }
  }

  const handleStart = async () => {
    if (!resolvedRole) { setSetupError('Choose a role, or type your own, before starting.'); return }
    setSetupLoading(true)
    setSetupError('')
    try {
      const { questions: qs } = await generateInterviewQuestions({ role: resolvedRole, seniority })
      const mapped: SessionQuestion[] = qs.map(q => ({
        ...q,
        category: categorize(q.type),
        status: 'unanswered',
        submittedAnswer: null,
        submittedAt: null,
        feedback: null,
        feedbackError: null,
      }))
      setRole(resolvedRole)
      setQuestions(mapped)
      setModelAnswers({})
      // Kick off all model answers now, in the background, so they're ready
      // and instant by the time the user clicks "Show me the answer".
      mapped.forEach(q => { void prefetchModelAnswer(q.id) })
      const counts: Record<Category, number> = { fundamentals: 0, system_design: 0, real_world: 0 }
      mapped.forEach(q => counts[q.category]++)
      const firstTab = (Object.keys(counts) as Category[]).reduce((a, b) => counts[a] >= counts[b] ? a : b)
      setActiveTab(firstTab)
      selectQuestion(mapped.find(q => q.category === firstTab)?.id ?? mapped[0]?.id ?? null)
    } catch {
      setSetupError('Could not connect to the API. Make sure the backend is running.')
    } finally {
      setSetupLoading(false)
    }
  }

  const advanceToNextUnanswered = (fromId: number | null) => {
    const unanswered = questions.filter(q => q.status !== 'answered' && q.id !== fromId)
    if (unanswered.length === 0) { selectQuestion(null); return }
    const sameTab = unanswered.find(q => q.category === activeTab)
    const next = sameTab ?? unanswered[0]
    if (!sameTab) setActiveTab(next.category)
    selectQuestion(next.id)
  }

  const submitAnswer = async () => {
    const question = questions.find(q => q.id === activeQuestionId)
    if (!question || !answerDraft.trim()) return
    const answerText = answerDraft.trim()
    setSubmitError('')
    setQuestions(prev => prev.map(q => q.id === question.id ? { ...q, status: 'evaluating', submittedAnswer: answerText, submittedAt: new Date().toISOString() } : q))
    setAnswerDraft('')
    try {
      const fb = await evaluateInterviewAnswer({ question_id: question.id, answer_text: answerText })
      setQuestions(prev => prev.map(q => q.id === question.id ? { ...q, status: 'answered', feedback: fb, feedbackError: null } : q))
    } catch {
      setQuestions(prev => prev.map(q => q.id === question.id ? { ...q, status: 'unanswered', feedbackError: 'Could not evaluate your answer. Check that the API is running and try again.' } : q))
      setAnswerDraft(answerText)
    }
  }

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submitAnswer()
    }
  }

  const reset = () => {
    setQuestions([])
    setModelAnswers({})
    setRole('')
    setSelectedRoleKey(null)
    setCustomRole('')
    setSeniority('Mid-level')
    setSetupError('')
    setActiveQuestionId(null)
    setAnswerDraft('')
    setSubmitError('')
  }

  /* ── Setup Screen ─────────────────────────────────────────── */
  if (questions.length === 0) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <span className="eyebrow mb-3 inline-flex">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
            Interview Coach
          </span>
          <h1 className="text-2xl md:text-3xl font-display font-medium text-[var(--color-ink)] mt-3 mb-2">
            Choose the room you&apos;re walking into.
          </h1>
          <p className="text-sm text-[var(--color-ink-dim)] leading-relaxed max-w-xl">
            Pick your target role and seniority. We generate technical and behavioral questions,
            then score your typed answers so you know exactly where you stand.
          </p>
        </div>

        <div className="eyebrow mb-3">Role</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          {ROLE_PRESETS.map((preset, i) => {
            const selected = selectedRoleKey === preset.key
            return (
              <motion.button
                key={preset.key}
                type="button"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.04, ease: EASE }}
                onClick={() => setSelectedRoleKey(preset.key)}
                className="text-left rounded-[10px] p-4 transition-colors"
                style={{
                  border: selected ? '1px solid var(--color-accent)' : '1px solid var(--color-canvas-line)',
                  background: selected ? 'var(--color-accent-tint)' : 'var(--color-canvas-raise)',
                }}
              >
                <div className="eyebrow text-[10px] mb-1.5">{preset.family}</div>
                <div className="text-sm font-medium text-[var(--color-ink)] mb-1">{preset.label}</div>
                <div className="text-xs text-[var(--color-ink-dim)] leading-relaxed">{preset.desc}</div>
              </motion.button>
            )
          })}

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: ROLE_PRESETS.length * 0.04, ease: EASE }}
            onClick={() => setSelectedRoleKey('custom')}
            className="text-left rounded-[10px] p-4 cursor-text transition-colors"
            style={{
              border: selectedRoleKey === 'custom' ? '1px solid var(--color-accent)' : '1px solid var(--color-canvas-line)',
              background: selectedRoleKey === 'custom' ? 'var(--color-accent-tint)' : 'var(--color-canvas-raise)',
            }}
          >
            <div className="eyebrow text-[10px] mb-1.5">Custom</div>
            <input
              value={customRole}
              onChange={e => { setCustomRole(e.target.value); setSelectedRoleKey('custom') }}
              onFocus={() => setSelectedRoleKey('custom')}
              placeholder="Type any role — e.g. Staff Backend Engineer"
              className="w-full bg-transparent text-sm font-medium text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] placeholder:font-normal focus:outline-none"
            />
          </motion.div>
        </div>

        <div className="eyebrow mb-3">Seniority</div>
        <div className="relative inline-flex mb-8 rounded-[6px] border border-[var(--color-canvas-line)] p-1">
          {SENIORITIES.map(s => {
            const active = seniority === s
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSeniority(s)}
                className="relative px-4 py-1.5 rounded-[4px] text-sm font-medium transition-colors"
              >
                {active && (
                  <motion.span
                    layoutId="seniority-thumb"
                    className="absolute inset-0 rounded-[4px] bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line)]"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                )}
                <span className={`relative z-10 ${active ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)]'}`}>
                  {s}
                </span>
              </button>
            )
          })}
        </div>

        <div className="card p-5 mb-6">
          <div className="eyebrow mb-3">What this covers</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              'Technical questions across fundamentals & system design',
              'Real-world / behavioral scenarios for your target role',
              'Type a real answer — get a real, scored evaluation',
              'A sample ideal answer alongside your own feedback',
            ].map(item => (
              <div key={item} className="flex items-start gap-2 text-xs text-[var(--color-ink-dim)]">
                <CheckCircle2 strokeWidth={1.5} className="w-3.5 h-3.5 text-[var(--color-accent)] mt-0.5 shrink-0" />
                {item}
              </div>
            ))}
          </div>
        </div>

        <AnimatePresence>
          {setupError && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-start gap-2 text-sm text-[var(--color-error)] border-l-[3px] border-[var(--color-error)] pl-3 py-1.5 mb-4 overflow-hidden"
            >
              {setupError}
            </motion.div>
          )}
        </AnimatePresence>

        <button
          type="button"
          onClick={handleStart}
          disabled={setupLoading || !resolvedRole}
          className="btn-primary"
        >
          {setupLoading ? (
            <>
              <span className="w-4 h-4 rounded-full border-2 border-[var(--color-on-accent)]/30 border-t-[var(--color-on-accent)] animate-spin" />
              Generating questions…
            </>
          ) : (
            'Start session'
          )}
        </button>
      </div>
    )
  }

  /* ── Session Screen ───────────────────────────────────────── */
  return (
    <div className="max-w-[760px] mx-auto pb-40">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-display font-medium text-[var(--color-ink)]">{role} · {seniority}</h1>
          <p className="text-sm text-[var(--color-ink-dim)] mt-0.5">{answeredCount} / {questions.length} answered</p>
        </div>
        <button onClick={reset} className="btn-ghost flex items-center gap-1.5">
          <RotateCcw strokeWidth={1.5} className="w-3.5 h-3.5" />
          New session
        </button>
      </div>

      <div className="w-full h-[1.5px] bg-[var(--color-canvas-line)] rounded-full mb-6 overflow-hidden">
        <motion.div
          className="h-full bg-[var(--color-accent)]"
          animate={{ width: questions.length > 0 ? `${(answeredCount / questions.length) * 100}%` : '0%' }}
          transition={{ duration: 0.4, ease: EASE }}
        />
      </div>

      {allAnswered ? (
        <SessionSummary role={role} seniority={seniority} questions={questions} />
      ) : (
        <>
          <div className="flex items-center gap-5 mb-5 border-b border-[var(--color-canvas-line)]">
            {(Object.entries(CATS) as [Category, (typeof CATS)[Category]][]).map(([key, c]) => {
              const count = byCategory(key).length
              if (count === 0) return null
              const done = byCategory(key).filter(q => q.status === 'answered').length
              const active = activeTab === key
              return (
                <button
                  key={key}
                  onClick={() => {
                    setActiveTab(key)
                    const firstUnanswered = byCategory(key).find(q => q.status !== 'answered')
                    if (firstUnanswered) selectQuestion(firstUnanswered.id)
                  }}
                  className="flex items-center gap-2 pb-3 eyebrow border-b-2 transition-colors"
                  style={{
                    color: active ? 'var(--color-ink)' : 'var(--color-ink-faint)',
                    borderBottomColor: active ? 'var(--color-accent)' : 'transparent',
                  }}
                >
                  {c.label}
                  <span className="font-mono text-[10px] text-[var(--color-ink-faint)]">{done}/{count}</span>
                </button>
              )
            })}
          </div>

          <div className="space-y-3">
            {byCategory(activeTab).length === 0 ? (
              <div className="text-center py-16 text-[var(--color-ink-faint)] text-sm">
                No {CATS[activeTab].label} questions in this session.
              </div>
            ) : (
              byCategory(activeTab).map(q => (
                <QuestionCard
                  key={q.id}
                  ref={(el) => { questionRefs.current[q.id] = el }}
                  question={q}
                  index={questions.findIndex(x => x.id === q.id) + 1}
                  tag={CATS[q.category].tag}
                  isActive={q.id === activeQuestionId}
                  modelAnswer={modelAnswers[q.id]}
                  onRetryModelAnswer={() => prefetchModelAnswer(q.id)}
                  onSelect={() => selectQuestion(q.id)}
                  onNext={() => advanceToNextUnanswered(q.id)}
                  onEndSession={reset}
                />
              ))
            )}
          </div>
        </>
      )}

      {!allAnswered && activeQuestion && activeQuestion.status !== 'answered' && (
        <div className="sticky bottom-4 sm:bottom-6 mt-4">
          <div className="card p-4" style={{ boxShadow: 'var(--shadow-raised)' }}>
            <AnimatePresence>
              {submitError && (
                <div className="text-xs text-[var(--color-error)] mb-2">{submitError}</div>
              )}
            </AnimatePresence>
            <textarea
              ref={textareaRef}
              value={answerDraft}
              onChange={e => setAnswerDraft(e.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Type your answer…"
              rows={2}
              className="w-full bg-transparent text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:outline-none resize-none max-h-[144px] sm:max-h-[144px] overflow-y-auto"
              disabled={activeQuestion.status === 'evaluating'}
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--color-ink-faint)]">
                ⌘/Ctrl + Enter to submit
              </span>
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-[var(--color-ink-faint)]">{answerDraft.length}</span>
                <button
                  type="button"
                  onClick={submitAnswer}
                  disabled={!answerDraft.trim() || activeQuestion.status === 'evaluating'}
                  className="btn-primary py-2 px-4 text-sm"
                >
                  Submit answer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Model Answer Panel ─────────────────────────────────────── */

function ModelAnswerPanel({
  modelAnswer,
  onRetry,
}: {
  modelAnswer: ModelAnswerState | undefined
  onRetry: () => void
}) {
  const [open, setOpen] = useState(false)

  const status = modelAnswer?.status ?? 'loading'
  const data = modelAnswer?.data ?? null
  // The answer is prefetched on session start. If the user clicks before that
  // background fetch finishes, we show a brief "preparing" state and auto-reveal
  // the moment it's ready — but in the common case it's already ready = instant.
  const showContent = open && status === 'ready' && data

  const handleClick = () => {
    if (status === 'error') { onRetry(); setOpen(true); return }
    setOpen(v => !v)
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={handleClick}
        className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-[var(--color-accent)] hover:text-[var(--color-accent-light)] transition-colors"
      >
        {open && status === 'loading' ? (
          <span className="w-3.5 h-3.5 rounded-full border-2 border-[var(--color-accent)]/30 border-t-[var(--color-accent)] animate-spin" />
        ) : (
          <Lightbulb strokeWidth={1.5} className="w-3.5 h-3.5" />
        )}
        {showContent
          ? 'Hide the answer'
          : open && status === 'loading'
            ? 'Preparing answer…'
            : status === 'error'
              ? 'Retry loading answer'
              : 'Show me the answer'}
      </button>

      {open && status === 'error' && (
        <p className="text-xs text-[var(--color-error)] mt-2">
          Could not load the answer. Check the API is running, then retry.
        </p>
      )}

      <AnimatePresence initial={false}>
        {showContent && data && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div
              className="mt-3 rounded-[10px] p-4 space-y-4"
              style={{ border: '1px solid var(--color-accent)', background: 'var(--color-accent-tint)' }}
            >
              {data.ideal_answer && (
                <div>
                  <span className="eyebrow text-[10px] mb-1.5 flex items-center gap-1.5">
                    <Sparkles strokeWidth={1.5} className="w-3 h-3 text-[var(--color-accent)]" />
                    Model answer
                  </span>
                  <p className="text-sm text-[var(--color-ink)] leading-relaxed whitespace-pre-line">{data.ideal_answer}</p>
                </div>
              )}

              {data.example && (
                <div>
                  <span className="eyebrow text-[10px] mb-1.5 block">Example</span>
                  <p className="text-sm text-[var(--color-ink-subtle)] leading-relaxed whitespace-pre-line pl-3" style={{ borderLeft: '3px solid var(--color-accent)' }}>
                    {data.example}
                  </p>
                </div>
              )}

              {data.plain_explanation && (
                <div>
                  <span className="eyebrow text-[10px] mb-1.5 block">In plain terms</span>
                  <p className="text-sm text-[var(--color-ink-dim)] leading-relaxed whitespace-pre-line">{data.plain_explanation}</p>
                </div>
              )}

              {data.key_points.length > 0 && (
                <div>
                  <span className="eyebrow text-[10px] mb-2 block">What the interviewer wants to hear</span>
                  <ul className="space-y-1.5">
                    {data.key_points.map((point, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-[var(--color-ink-subtle)] leading-relaxed">
                        <CheckCircle2 strokeWidth={1.5} className="w-3.5 h-3.5 text-[var(--color-accent)] mt-0.5 shrink-0" />
                        {point}
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

/* ─── Question Card ──────────────────────────────────────────── */

const QuestionCard = forwardRef<HTMLDivElement, {
  question: SessionQuestion
  index: number
  tag: 'TECHNICAL' | 'BEHAVIORAL'
  isActive: boolean
  modelAnswer: ModelAnswerState | undefined
  onRetryModelAnswer: () => void
  onSelect: () => void
  onNext: () => void
  onEndSession: () => void
}>(function QuestionCard({ question, index, tag, isActive, modelAnswer, onRetryModelAnswer, onSelect, onNext, onEndSession }, ref) {
  const [showSample, setShowSample] = useState(false)
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
          {question.status === 'answered' && <CheckCircle2 strokeWidth={1.5} className="w-4 h-4 text-[var(--color-signal-high)] shrink-0" />}
        </div>
        <p className="text-base text-[var(--color-ink)] leading-relaxed">{question.text}</p>

        {question.status === 'unanswered' && !isActive && (
          <button
            type="button"
            onClick={onSelect}
            className="btn-ghost mt-4"
          >
            Answer this question
          </button>
        )}

        {/* Always available — learn the ideal answer without having to attempt first */}
        {question.status !== 'answered' && (
          <ModelAnswerPanel modelAnswer={modelAnswer} onRetry={onRetryModelAnswer} />
        )}

        {question.feedbackError && (
          <div className="mt-3 text-xs text-[var(--color-error)]">{question.feedbackError}</div>
        )}
      </div>

      {question.submittedAnswer && (
        <div className="border-t border-[var(--color-canvas-line)] p-5 pt-4" style={{ background: 'var(--color-canvas)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="eyebrow text-[10px]">Your answer</span>
            {question.submittedAt && (
              <span className="text-[10px] font-mono text-[var(--color-ink-faint)]">
                {new Date(question.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
          <p className="text-sm text-[var(--color-ink-subtle)] leading-relaxed whitespace-pre-line">{question.submittedAnswer}</p>

          {question.status === 'evaluating' && (
            <div className="relative mt-4 pt-3">
              <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-[var(--color-canvas-line)] overflow-hidden">
                <motion.div
                  className="h-full w-1/3 bg-[var(--color-accent)]"
                  animate={{ x: ['-100%', '300%'] }}
                  transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }}
                />
              </div>
              <span className="eyebrow text-[10px] text-[var(--color-ink-dim)]">Evaluating</span>
            </div>
          )}

          {question.status === 'answered' && question.feedback && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: EASE }}
              className="mt-4 pt-4 border-t border-[var(--color-canvas-line)]"
            >
              <span className="eyebrow text-[10px] mb-3 block">Feedback — Question {String(index).padStart(2, '0')}</span>

              <div className="flex items-center gap-3 mb-4">
                <span className="text-xs text-[var(--color-ink-dim)] w-10 shrink-0">Score</span>
                <div className="flex-1 h-1 rounded-full bg-[var(--color-canvas-line)] overflow-hidden">
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

              <p className="text-sm text-[var(--color-ink-subtle)] leading-relaxed mb-3">{question.feedback.feedback}</p>

              {question.feedback.improvement_tips && (
                <div className="mb-4">
                  <span className="eyebrow text-[10px] mb-1.5 block">Improve</span>
                  <p className="text-sm text-[var(--color-ink-dim)] leading-relaxed">{question.feedback.improvement_tips}</p>
                </div>
              )}

              {question.feedback.sample_answer && (
                <div className="mb-4">
                  <button
                    type="button"
                    onClick={() => setShowSample(v => !v)}
                    className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] transition-colors"
                  >
                    <motion.span animate={{ rotate: showSample ? 90 : 0 }} transition={{ duration: 0.15 }}>
                      <ChevronRight strokeWidth={1.5} className="w-3.5 h-3.5" />
                    </motion.span>
                    View sample ideal answer
                  </button>
                  <AnimatePresence initial={false}>
                    {showSample && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.15 }}
                        className="overflow-hidden"
                      >
                        <p
                          className="text-sm text-[var(--color-ink-dim)] leading-relaxed mt-3 pl-3.5 py-0.5"
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
                <button type="button" onClick={onNext} className="btn-primary py-2 px-4 text-sm">
                  Next question
                  <ChevronDown strokeWidth={1.5} className="w-3.5 h-3.5 -rotate-90" />
                </button>
                <button type="button" onClick={onEndSession} className="btn-ghost">
                  End session
                </button>
              </div>
            </motion.div>
          )}
        </div>
      )}
    </div>
  )
})

/* ─── Session Summary ────────────────────────────────────────── */

function SessionSummary({ role, seniority, questions }: { role: string; seniority: string; questions: SessionQuestion[] }) {
  const reduceMotion = usePrefersReducedMotion()
  const scores = questions.map(q => q.feedback?.score ?? 0)
  const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0

  return (
    <motion.div
      initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
      className="card p-8 text-center"
    >
      <span className="eyebrow mb-3 inline-flex">{role} · {seniority}</span>
      <h2 className="text-2xl font-display font-medium text-[var(--color-ink)] mb-2">Session complete</h2>
      <p className="text-sm text-[var(--color-ink-dim)] mb-6">
        You answered all {questions.length} question{questions.length !== 1 ? 's' : ''} in this session.
      </p>

      <div className="flex items-center justify-center gap-3 max-w-xs mx-auto mb-6">
        <span className="text-xs text-[var(--color-ink-dim)] w-20 shrink-0 text-left">Average score</span>
        <div className="flex-1 h-1 rounded-full bg-[var(--color-canvas-line)] overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ background: scoreColor(avg) }}
            initial={{ width: reduceMotion ? `${(avg / 10) * 100}%` : 0 }}
            animate={{ width: `${(avg / 10) * 100}%` }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.6, ease: EASE }}
          />
        </div>
        <span className="text-xs font-mono tabular-nums shrink-0" style={{ color: scoreColor(avg) }}>
          {avg.toFixed(1)} / 10
        </span>
      </div>

      <Link href="/history" className="text-xs text-[var(--color-ink-faint)] hover:text-[var(--color-accent)] transition-colors inline-flex items-center gap-1">
        View in history
        <ChevronRight strokeWidth={1.5} className="w-3 h-3" />
      </Link>
    </motion.div>
  )
}
