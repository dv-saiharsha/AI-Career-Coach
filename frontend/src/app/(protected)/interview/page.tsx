'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, RotateCcw, LogOut } from 'lucide-react'
import { ScreeningPrep } from '@/components/interview/ScreeningPrep'
import { InterviewPrep } from '@/components/interview/InterviewPrep'
import { VoiceAnswerComposer } from '@/components/interview/VoiceAnswerComposer'
import { QuestionCard } from '@/components/interview/SessionQuestionCard'
import { InterviewFeedbackPanel } from '@/components/interview/InterviewFeedbackPanel'
import type {
  ModelAnswerState,
  SessionQuestion,
} from '@/components/interview/interviewShared'
import {
  generateInterviewQuestions,
  evaluateInterviewAnswer,
  getInterviewModelAnswer,
  getActiveInterviewSession,
  abandonInterviewSession,
  getInterviewSessionReport,
  type InterviewFeedback,
  type ActiveSession,
  type SessionReport,
  type PrepCategory,
  type VoiceMetrics,
} from '../../../lib/apiClient'
import { INTERVIEW_CATEGORIES, categoryLabel } from '../../../lib/interviewCategories'
import { usePrefersReducedMotion } from '../../../lib/usePrefersReducedMotion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'


const SENIORITIES = ['Junior', 'Mid-level', 'Senior', 'Staff']

const ROLE_PRESETS = [
  { key: 'data-scientist', label: 'Data Scientist', family: 'ENGINEERING', desc: 'Statistics, experimentation, and turning data into decisions.' },
  { key: 'ml-engineer', label: 'ML Engineer', family: 'ENGINEERING', desc: 'Productionizing models — training, serving, and scale.' },
  { key: 'ai-engineer', label: 'AI Engineer', family: 'ENGINEERING', desc: 'LLM-powered products, prompting, and applied AI systems.' },
  { key: 'product-manager', label: 'Product Manager', family: 'PRODUCT', desc: 'Roadmaps, tradeoffs, and shipping the right thing.' },
  { key: 'sre', label: 'Site Reliability Engineer', family: 'OPERATIONS', desc: 'Reliability, incident response, and systems at scale.' },
] as const


function feedbackFromAnswer(answer: NonNullable<import('../../../lib/apiClient').ActiveQuestion['answer']>): InterviewFeedback {
  return {
    score: answer.score,
    dimension_scores: answer.dimension_scores,
    strengths: answer.strengths,
    weaknesses: answer.weaknesses,
    missing_points: answer.missing_points,
    learning_suggestions: answer.learning_suggestions,
    sample_answer: answer.sample_answer,
    voice_metrics: answer.voice_metrics,
  }
}

export default function InterviewCoach() {
  const reduceMotion = usePrefersReducedMotion()

  // ── Setup state ──────────────────────────────────────────────
  const [mode, setMode] = useState<'drills' | 'screening' | 'prep'>('drills')
  const [selectedRoleKey, setSelectedRoleKey] = useState<string | 'custom' | null>(null)
  const [customRole, setCustomRole] = useState('')
  const [seniority, setSeniority] = useState('Mid-level')
  const [category, setCategory] = useState<PrepCategory>('technical')
  // Chosen once at setup, like seniority and category — the input method
  // doesn't affect question content, so it's never sent to the backend; it
  // only decides which composer this page renders during the session.
  const [inputMode, setInputMode] = useState<'text' | 'voice'>('text')
  const [setupLoading, setSetupLoading] = useState(false)
  const [setupError, setSetupError] = useState('')

  // A session already in progress, detected once on mount — powers the
  // Resume Interview / Continue Later flow. Every answer is persisted the
  // moment it's submitted, so "resuming" is nothing more than re-fetching
  // this and rehydrating local state from it.
  const [resumable, setResumable] = useState<ActiveSession | null>(null)
  const [checkingResumable, setCheckingResumable] = useState(true)

  const checkForActiveSession = () => {
    setCheckingResumable(true)
    getActiveInterviewSession()
      .then(setResumable)
      .catch(() => setResumable(null))
      .finally(() => setCheckingResumable(false))
  }

  useEffect(() => {
    // A one-shot fetch on mount, not a value mirrored from props/state — the
    // "loading" flag it sets only reflects an in-flight network request.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot check on mount
    checkForActiveSession()
  }, [])

  // ── Session state ────────────────────────────────────────────
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [role, setRole] = useState('')
  const [questions, setQuestions] = useState<SessionQuestion[]>([])
  // Model answers are prefetched when the session starts so "Show me the
  // answer" reveals instantly instead of triggering a fetch on click. For
  // questions sourced from Interview Preparation's cache this costs no
  // Claude call at all — see the /model-answer endpoint.
  const [modelAnswers, setModelAnswers] = useState<Record<number, ModelAnswerState>>({})
  const [activeQuestionId, setActiveQuestionId] = useState<number | null>(null)
  const [answerDraft, setAnswerDraft] = useState('')
  // Set only by an accepted voice transcript; cleared on re-record, on
  // switching questions, and once submitted — never sent for a typed answer.
  const [pendingVoiceMetrics, setPendingVoiceMetrics] = useState<VoiceMetrics | null>(null)
  const [submitError, setSubmitError] = useState('')
  const [restarting, setRestarting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const questionRefs = useRef<Record<number, HTMLDivElement | null>>({})

  // ── Final report state ───────────────────────────────────────
  const [report, setReport] = useState<SessionReport | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState('')

  // Handoff from /jobs: "Practice" navigates here as /interview?role=<title>.
  // Read once on mount from window.location rather than useSearchParams —
  // this is a one-shot seed, and useSearchParams would subscribe the
  // component to param changes and pull a Suspense requirement into a page
  // that otherwise needs none.
  //
  // set-state-in-effect is suppressed for the same reason as the /resume
  // handoff: this route is server-rendered behind an auth redirect, so
  // seeding selection state in a lazy initializer would desync hydration
  // (server renders nothing selected, client renders a selected preset).
  useEffect(() => {
    const incoming = new URLSearchParams(window.location.search).get('role')?.trim()
    if (!incoming) return
    /* eslint-disable react-hooks/set-state-in-effect -- see comment above */
    // Prefer an exact preset match so the user lands on the curated role
    // (with its seeded question bank) instead of the free-text path.
    const preset = ROLE_PRESETS.find(r => r.label.toLowerCase() === incoming.toLowerCase())
    if (preset) {
      setSelectedRoleKey(preset.key)
      return
    }
    // Real job titles ("Principal AI & ML Engineer - Remote") rarely match a
    // preset, so the custom field is the normal outcome here, not a fallback.
    setSelectedRoleKey('custom')
    setCustomRole(incoming)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [])

  const resolvedRole = selectedRoleKey === 'custom' ? customRole.trim() : ROLE_PRESETS.find(r => r.key === selectedRoleKey)?.label ?? ''

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
    setPendingVoiceMetrics(null)
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

  // Fetches the final report the moment every question has an answer. The
  // backend marks the session completed synchronously inside the last
  // /evaluate call, so there is no race between allAnswered flipping here
  // and the report becoming available.
  useEffect(() => {
    if (!allAnswered || sessionId == null || report || reportLoading) return
    // "loading" here reflects an in-flight request this same effect starts,
    // not a value derived from props/state that belongs in a render instead.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    setReportLoading(true)
    setReportError('')
    getInterviewSessionReport(sessionId)
      .then(setReport)
      .catch(() => setReportError('Could not load your interview report. Check that the API is running and try again.'))
      .finally(() => setReportLoading(false))
  }, [allAnswered, sessionId, report, reportLoading])

  const startSession = async (forRole: string, forSeniority: string, forCategory: PrepCategory) => {
    const { session_id, role: r, seniority: s, category: c, questions: qs } =
      await generateInterviewQuestions({ role: forRole, seniority: forSeniority, category: forCategory })
    const mapped: SessionQuestion[] = qs.map(q => ({
      ...q,
      status: 'unanswered',
      submittedAnswer: null,
      submittedAt: null,
      feedback: null,
      feedbackError: null,
    }))
    setSessionId(session_id)
    setRole(r)
    setSeniority(s)
    setCategory(c)
    setQuestions(mapped)
    setReport(null)
    setResumable(null)
    setModelAnswers({})
    mapped.forEach(q => { void prefetchModelAnswer(q.id) })
    selectQuestion(mapped[0]?.id ?? null)
  }

  const handleStart = async () => {
    if (!resolvedRole) { setSetupError('Choose a role, or type your own, before starting.'); return }
    setSetupLoading(true)
    setSetupError('')
    try {
      await startSession(resolvedRole, seniority, category)
    } catch {
      setSetupError('Could not connect to the API. Make sure the backend is running.')
    } finally {
      setSetupLoading(false)
    }
  }

  const resumeActiveSession = (active: ActiveSession) => {
    const mapped: SessionQuestion[] = active.questions
      .slice()
      .sort((a, b) => a.sequence_order - b.sequence_order)
      .map(q => ({
        id: q.id,
        text: q.text,
        type: q.type,
        sequence_order: q.sequence_order,
        status: q.answer ? 'answered' : 'unanswered',
        submittedAnswer: q.answer?.answer_text ?? null,
        submittedAt: null,
        feedback: q.answer ? feedbackFromAnswer(q.answer) : null,
        feedbackError: null,
      }))
    setSessionId(active.session_id)
    setRole(active.role)
    setSeniority(active.seniority)
    setCategory(active.category)
    setQuestions(mapped)
    setReport(null)
    setResumable(null)
    setModelAnswers({})
    mapped.forEach(q => { void prefetchModelAnswer(q.id) })
    const firstUnanswered = mapped.find(q => q.status !== 'answered')
    selectQuestion(firstUnanswered?.id ?? null)
  }

  const advanceToNextUnanswered = (fromId: number | null) => {
    const unanswered = questions.filter(q => q.status !== 'answered' && q.id !== fromId)
    selectQuestion(unanswered[0]?.id ?? null)
  }

  const submitAnswer = async () => {
    const question = questions.find(q => q.id === activeQuestionId)
    if (!question || !answerDraft.trim()) return
    const answerText = answerDraft.trim()
    // Snapshot before clearing — editing the transcript is expected and
    // fine, but the metrics must still describe what was actually spoken,
    // not be silently dropped just because the draft field changed.
    const voiceMetrics = pendingVoiceMetrics
    setSubmitError('')
    setQuestions(prev => prev.map(q => q.id === question.id ? { ...q, status: 'evaluating', submittedAnswer: answerText, submittedAt: new Date().toISOString() } : q))
    setAnswerDraft('')
    setPendingVoiceMetrics(null)
    try {
      const fb = await evaluateInterviewAnswer({ question_id: question.id, answer_text: answerText, voice_metrics: voiceMetrics })
      setQuestions(prev => prev.map(q => q.id === question.id ? { ...q, status: 'answered', feedback: fb, feedbackError: null } : q))
    } catch {
      setQuestions(prev => prev.map(q => q.id === question.id ? { ...q, status: 'unanswered', feedbackError: 'Could not evaluate your answer. Check that the API is running and try again.' } : q))
      setAnswerDraft(answerText)
      setPendingVoiceMetrics(voiceMetrics)
    }
  }

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submitAnswer()
    }
  }

  // Exit Interview: leaves the session exactly as it is server-side (every
  // answer already persisted) so it comes back via Continue Later. Nothing
  // here abandons anything.
  const exitInterview = () => {
    setSessionId(null)
    setQuestions([])
    setModelAnswers({})
    setReport(null)
    setReportError('')
    setRole('')
    setSelectedRoleKey(null)
    setCustomRole('')
    setSeniority('Mid-level')
    setSetupError('')
    setActiveQuestionId(null)
    setAnswerDraft('')
    setPendingVoiceMetrics(null)
    setSubmitError('')
    checkForActiveSession()
  }

  // Restart Interview: explicitly abandon the current attempt (its answers
  // stay in history, just no longer resumable), then start a fresh one with
  // the same role, seniority, and category.
  const restartInterview = async () => {
    if (sessionId == null) return
    setRestarting(true)
    setSubmitError('')
    try {
      await abandonInterviewSession(sessionId)
      await startSession(role, seniority, category)
    } catch {
      setSubmitError('Could not restart the interview. Check the API and try again.')
    } finally {
      setRestarting(false)
    }
  }

  /* ── Setup Screen ─────────────────────────────────────────── */
  if (questions.length === 0) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <span className="eyebrow mb-3 inline-flex">
            <span className="w-1.5 h-1.5 rounded-full bg-(--color-accent)" />
            Interview Coach
          </span>
          <h1 className="text-2xl md:text-3xl font-display font-medium text-(--color-ink) mt-3 mb-2">
            Choose the room you&apos;re walking into.
          </h1>
          <p className="text-sm text-(--color-ink-dim) leading-relaxed max-w-xl">
            {mode === 'drills'
              ? 'Pick your target role and category. We source questions from Interview Preparation and score your typed answers across seven dimensions so you know exactly where you stand.'
              : mode === 'screening'
                ? 'Paste a posting and get the questions a recruiter screen actually opens with — each with an answer template you fill in from your own experience.'
                : 'Browse questions with the full answer, explanation, and context up front — for understanding the concept, not testing yourself on it.'}
          </p>
        </div>

        {mode === 'drills' && !checkingResumable && resumable && (
          <div
           
           
            className="card p-5 mb-6 flex items-start justify-between gap-4 flex-wrap panel-enter"
            style={{ border: '1px solid var(--color-accent)', background: 'var(--color-accent-tint)' }}
          >
            <div>
              <span className="eyebrow mb-1.5 inline-flex">Interview in progress</span>
              <p className="text-sm font-medium text-(--color-ink) mb-1">
                {resumable.role} · {resumable.seniority} · {categoryLabel(resumable.category)}
              </p>
              <p className="text-xs text-(--color-ink-dim)">
                {resumable.questions.filter(q => q.answer).length} of {resumable.questions.length} answered
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button type="button" size="sm" onClick={() => resumeActiveSession(resumable)}>
                Resume interview
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setResumable(null)}>
                Start new instead
              </Button>
            </div>
          </div>
        )}

        <div className="relative inline-flex mb-8 flex-wrap rounded-[6px] border border-(--color-canvas-line) p-1">
          {([
            ['drills', 'Practice drills'],
            ['screening', 'Screening prep'],
            ['prep', 'Learn concepts'],
          ] as const).map(([key, label]) => {
            const active = mode === key
            return (
              <Button
                key={key}
                type="button"
                variant="ghost"
                aria-pressed={active}
                onClick={() => setMode(key)}
                className="relative h-auto rounded-[4px] px-4 py-1.5 text-sm font-medium hover:bg-transparent"
              >
                {active && (
                  <span
                   
                    className="absolute inset-0 rounded-[4px] bg-(--color-canvas-raise) border border-(--color-canvas-line) panel-enter"
                    />
                )}
                <span className={`relative z-10 ${active ? 'text-(--color-ink)' : 'text-(--color-ink-faint) hover:text-(--color-ink-dim)'}`}>
                  {label}
                </span>
              </Button>
            )
          })}
        </div>

        {mode === 'screening' ? (
          <ScreeningPrep initialRole={resolvedRole} />
        ) : mode === 'prep' ? (
          <InterviewPrep initialRole={resolvedRole} />
        ) : (
        <>
        {/* .eyebrow is inline-flex (for icon+text eyebrows elsewhere) — an
            explicit block display keeps this label from riding up onto the
            same line as the inline-flex mode-tab pill row above it. */}
        <div className="eyebrow mb-3" style={{ display: 'block' }}>Role</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          {ROLE_PRESETS.map((preset) => {
            const selected = selectedRoleKey === preset.key
            return (
              <button
                key={preset.key}
                type="button"
               
               
               
                onClick={() => setSelectedRoleKey(preset.key)}
                className="text-left rounded-[10px] p-4 transition-colors panel-enter"
                style={{
                  border: selected ? '1px solid var(--color-accent)' : '1px solid var(--color-canvas-line)',
                  background: selected ? 'var(--color-accent-tint)' : 'var(--color-canvas-raise)',
                }}
              >
                <div className="eyebrow text-[10px] mb-1.5">{preset.family}</div>
                <div className="text-sm font-medium text-(--color-ink) mb-1">{preset.label}</div>
                <div className="text-xs text-(--color-ink-dim) leading-relaxed">{preset.desc}</div>
              </button>
            )
          })}

          <div
           
           
           
            onClick={() => setSelectedRoleKey('custom')}
            className="text-left rounded-[10px] p-4 cursor-text transition-colors panel-enter"
            style={{
              border: selectedRoleKey === 'custom' ? '1px solid var(--color-accent)' : '1px solid var(--color-canvas-line)',
              background: selectedRoleKey === 'custom' ? 'var(--color-accent-tint)' : 'var(--color-canvas-raise)',
            }}
          >
            <div className="eyebrow text-[10px] mb-1.5">Custom</div>
            {/* Borderless: the surrounding card is the visible field, so the
                primitive's own chrome is stripped rather than doubled up. */}
            <Input
              aria-label="Custom role"
              value={customRole}
              onChange={e => { setCustomRole(e.target.value); setSelectedRoleKey('custom') }}
              onFocus={() => setSelectedRoleKey('custom')}
              placeholder="Type any role — e.g. Staff Backend Engineer"
              className="h-auto border-0 bg-transparent px-0 text-sm font-medium shadow-none focus-visible:border-0 focus-visible:shadow-none"
            />
          </div>
        </div>

        <div className="eyebrow mb-3" style={{ display: 'block' }}>Seniority</div>
        <div className="relative inline-flex mb-8 rounded-[6px] border border-(--color-canvas-line) p-1">
          {SENIORITIES.map(s => {
            const active = seniority === s
            return (
              <Button
                key={s}
                type="button"
                variant="ghost"
                aria-pressed={active}
                onClick={() => setSeniority(s)}
                className="relative h-auto rounded-[4px] px-4 py-1.5 text-sm font-medium hover:bg-transparent"
              >
                {active && (
                  <span
                   
                    className="absolute inset-0 rounded-[4px] bg-(--color-canvas-raise) border border-(--color-canvas-line) panel-enter"
                    />
                )}
                <span className={`relative z-10 ${active ? 'text-(--color-ink)' : 'text-(--color-ink-faint) hover:text-(--color-ink-dim)'}`}>
                  {s}
                </span>
              </Button>
            )
          })}
        </div>

        <div className="eyebrow mb-3" style={{ display: 'block' }}>Category</div>
        <div className="flex flex-wrap gap-1.5 mb-8">
          {INTERVIEW_CATEGORIES.map(c => (
            <button
              key={c.value}
              type="button"
              aria-pressed={category === c.value}
              onClick={() => setCategory(c.value)}
              className="chip transition-colors"
              style={{
                borderColor: category === c.value ? 'var(--color-accent)' : 'var(--color-canvas-line)',
                color: category === c.value ? 'var(--color-accent)' : 'var(--color-ink-dim)',
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="eyebrow mb-3" style={{ display: 'block' }}>Input method</div>
        <div className="relative inline-flex mb-8 rounded-[6px] border border-(--color-canvas-line) p-1">
          {(['text', 'voice'] as const).map(m => {
            const active = inputMode === m
            return (
              <Button
                key={m}
                type="button"
                variant="ghost"
                aria-pressed={active}
                onClick={() => setInputMode(m)}
                className="relative h-auto rounded-[4px] px-4 py-1.5 text-sm font-medium hover:bg-transparent"
              >
                {active && (
                  <span
                   
                    className="absolute inset-0 rounded-[4px] bg-(--color-canvas-raise) border border-(--color-canvas-line) panel-enter"
                    />
                )}
                <span className={`relative z-10 ${active ? 'text-(--color-ink)' : 'text-(--color-ink-faint) hover:text-(--color-ink-dim)'}`}>
                  {m === 'text' ? 'Type answers' : 'Speak answers'}
                </span>
              </Button>
            )
          })}
        </div>

        <div className="card p-5 mb-6">
          <div className="eyebrow mb-3">What this covers</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              'Questions sourced from Interview Preparation for this role & category',
              'Scored across seven dimensions, not one opaque number',
              'Type a real answer — get strengths, gaps, and why they matter',
              'A final report: readiness, topics to improve, and a practice plan',
            ].map(item => (
              <div key={item} className="flex items-start gap-2 text-xs text-(--color-ink-dim)">
                <CheckCircle2 strokeWidth={1.5} className="w-3.5 h-3.5 text-(--color-accent) mt-0.5 shrink-0" />
                {item}
              </div>
            ))}
          </div>
        </div>

          {setupError && (
            <div
             
             
             
              className="flex items-start gap-2 text-sm text-(--color-error) border-l-[3px] border-(--color-error) pl-3 py-1.5 mb-4 overflow-hidden panel-enter"
            >
              {setupError}
            </div>
          )}

        <Button
          type="button"
          onClick={handleStart}
          disabled={setupLoading || !resolvedRole}
          aria-busy={setupLoading || undefined}
        >
          {setupLoading ? (
            <>
              <span className="w-4 h-4 rounded-full border-2 border-(--color-on-accent)/30 border-t-(--color-on-accent) animate-spin" />
              Generating questions…
            </>
          ) : (
            'Start session'
          )}
        </Button>
        </>
        )}
      </div>
    )
  }

  /* ── Session Screen ───────────────────────────────────────── */
  return (
    <div className="max-w-[760px] mx-auto pb-40">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-display font-medium text-(--color-ink)">
            {role} · {seniority} · {categoryLabel(category)}
          </h1>
          <p className="text-sm text-(--color-ink-dim) mt-0.5">{answeredCount} / {questions.length} answered</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={restartInterview} disabled={restarting}>
            <RotateCcw strokeWidth={1.5} />
            {restarting ? 'Restarting…' : 'Restart'}
          </Button>
          <Button variant="ghost" size="sm" onClick={exitInterview}>
            <LogOut strokeWidth={1.5} />
            Exit interview
          </Button>
        </div>
      </div>

      <div className="w-full h-[1.5px] bg-(--color-canvas-line) rounded-full mb-6 overflow-hidden">
        <div
          className="h-full bg-(--color-accent) panel-enter"
         
          />
      </div>

      {allAnswered ? (
        <InterviewFeedbackPanel
          report={report}
          loading={reportLoading}
          error={reportError}
          onRetry={() => sessionId != null && setReport(null)}
          onRestart={restartInterview}
          onExit={exitInterview}
          restarting={restarting}
        />
      ) : (
        <div className="space-y-3">
          {questions.map((q, i) => (
            <QuestionCard
              key={q.id}
              ref={(el) => { questionRefs.current[q.id] = el }}
              question={q}
              index={i + 1}
              tag={categoryLabel(category).toUpperCase()}
              isActive={q.id === activeQuestionId}
              modelAnswer={modelAnswers[q.id]}
              onRetryModelAnswer={() => prefetchModelAnswer(q.id)}
              onSelect={() => selectQuestion(q.id)}
              onNext={() => advanceToNextUnanswered(q.id)}
              onExit={exitInterview}
            />
          ))}
        </div>
      )}

      {!allAnswered && activeQuestion && activeQuestion.status !== 'answered' && (
        <div className="sticky bottom-4 sm:bottom-6 mt-4">
          <div className="card p-4" style={{ boxShadow: 'var(--shadow-raised)' }}>
              {submitError && (
                <div className="text-xs text-(--color-error) mb-2">{submitError}</div>
              )}

            {inputMode === 'voice' && (
              <div className={answerDraft.trim() ? 'mb-3 pb-3 border-b border-(--color-canvas-line)' : ''}>
                <VoiceAnswerComposer
                  disabled={activeQuestion.status === 'evaluating'}
                  onTranscriptReady={(transcript, metrics) => {
                    setAnswerDraft(transcript)
                    setPendingVoiceMetrics(metrics)
                  }}
                  onReset={() => {
                    setAnswerDraft('')
                    setPendingVoiceMetrics(null)
                  }}
                />
              </div>
            )}

            {(inputMode === 'text' || answerDraft.trim()) && (
            <>
            <Textarea
              ref={textareaRef}
              aria-label="Your answer"
              value={answerDraft}
              onChange={e => setAnswerDraft(e.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={inputMode === 'voice' ? 'Edit your transcript before submitting…' : 'Type your answer…'}
              rows={2}
              className="max-h-[144px] min-h-0 resize-none overflow-y-auto border-0 bg-transparent px-0 py-0 shadow-none focus-visible:border-0 focus-visible:shadow-none"
              disabled={activeQuestion.status === 'evaluating'}
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-(--color-ink-faint)">
                ⌘/Ctrl + Enter to submit
              </span>
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-(--color-ink-faint)">{answerDraft.length}</span>
                <Button
                  type="button"
                  size="sm"
                  onClick={submitAnswer}
                  disabled={!answerDraft.trim() || activeQuestion.status === 'evaluating'}
                >
                  Submit answer
                </Button>
              </div>
            </div>
            </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Model Answer Panel ─────────────────────────────────────── */
