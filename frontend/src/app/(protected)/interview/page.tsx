'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BookOpen, Layers, Globe, CheckCircle2, RefreshCw,
  Play, RotateCcw, Lightbulb, Trophy,
} from 'lucide-react'
import {
  generateInterviewQuestions,
  evaluateInterviewAnswer,
  type InterviewQuestion,
} from '../../../lib/apiClient'
import { useAccentPalette } from '../../../lib/useAccentPalette'

type Category = 'fundamentals' | 'system_design' | 'real_world'

interface SessionQuestion extends InterviewQuestion {
  category: Category
  revealed: boolean
  status: 'unseen' | 'got_it' | 'review'
  model_answer: string | null
  key_points: string[]
  answerLoading: boolean
}

function buildCats(palette: ReturnType<typeof useAccentPalette>): Record<Category, { label: string; icon: typeof BookOpen; color: string; desc: string }> {
  return {
    fundamentals: {
      label: 'Fundamentals',
      icon: BookOpen,
      color: palette.accent,
      desc: 'Core concepts every engineer must know cold',
    },
    system_design: {
      label: 'System Design',
      icon: Layers,
      color: palette.accentLight,
      desc: 'Architecture, scalability & real-world patterns',
    },
    real_world: {
      label: 'Real-World Scenarios',
      icon: Globe,
      color: '#F59E0B',
      desc: 'Why Netflix, Apple & Google work the way they do',
    },
  }
}

function categorize(type: string): Category {
  const t = type.toLowerCase()
  if (t.includes('system') || t.includes('design') || t.includes('arch') || t.includes('scale') || t.includes('infra')) return 'system_design'
  if (t.includes('real') || t.includes('scenario') || t.includes('case') || t.includes('behav') || t.includes('situational')) return 'real_world'
  return 'fundamentals'
}

const SENIORITIES = ['Junior', 'Mid-level', 'Senior', 'Staff']

export default function InterviewCoach() {
  const palette = useAccentPalette()
  const CATS = buildCats(palette)
  const [role, setRole] = useState('')
  const [seniority, setSeniority] = useState('Mid-level')
  const [setupLoading, setSetupLoading] = useState(false)
  const [setupError, setSetupError] = useState('')
  const [questions, setQuestions] = useState<SessionQuestion[]>([])
  const [activeTab, setActiveTab] = useState<Category>('fundamentals')

  const byCategory = (cat: Category) => questions.filter(q => q.category === cat)
  const gotItCount = questions.filter(q => q.status === 'got_it').length

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!role.trim()) { setSetupError('Enter the role you are preparing for.'); return }
    setSetupLoading(true)
    setSetupError('')
    try {
      const { questions: qs } = await generateInterviewQuestions({ role: role.trim(), seniority })
      const mapped: SessionQuestion[] = qs.map(q => ({
        ...q,
        category: categorize(q.type),
        revealed: false,
        status: 'unseen',
        model_answer: null,
        key_points: [],
        answerLoading: false,
      }))
      setQuestions(mapped)
      const counts: Record<Category, number> = { fundamentals: 0, system_design: 0, real_world: 0 }
      mapped.forEach(q => counts[q.category]++)
      setActiveTab((Object.keys(counts) as Category[]).reduce((a, b) => counts[a] >= counts[b] ? a : b))
    } catch {
      setSetupError('Could not connect to the API. Make sure the backend is running.')
    } finally {
      setSetupLoading(false)
    }
  }

  const revealAnswer = async (questionId: number) => {
    setQuestions(prev => prev.map(q => q.id === questionId ? { ...q, answerLoading: true } : q))
    try {
      const fb = await evaluateInterviewAnswer({ question_id: questionId, answer_text: '' })
      setQuestions(prev => prev.map(q =>
        q.id === questionId
          ? {
              ...q,
              revealed: true,
              answerLoading: false,
              model_answer: fb.sample_answer || fb.feedback || 'No model answer available yet.',
              key_points: fb.key_points ?? [],
            }
          : q,
      ))
    } catch {
      setQuestions(prev => prev.map(q =>
        q.id === questionId
          ? { ...q, revealed: true, answerLoading: false, model_answer: 'Answer unavailable — check that the API is running.', key_points: [] }
          : q,
      ))
    }
  }

  const setQuestionStatus = (id: number, status: SessionQuestion['status']) =>
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, status } : q))

  const reset = () => {
    setQuestions([])
    setRole('')
    setSeniority('Mid-level')
    setSetupError('')
  }

  /* ── Setup Screen ─────────────────────────────────────────── */
  if (questions.length === 0) {
    return (
      <div className="max-w-5xl relative">
        <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[500px] h-[400px] bg-[var(--color-accent)]/5 rounded-full blur-[150px] -z-10" />

        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-8"
        >
          <span className="section-eyebrow-violet mb-3 inline-flex">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
            AI Mock Interview
          </span>
          <h1 className="text-2xl md:text-3xl font-display font-semibold text-[var(--color-ink)] mt-3 mb-2">Interview Coach</h1>
          <p className="text-sm text-[var(--color-ink-dim)] leading-relaxed max-w-xl">
            Pick your target role and seniority. We generate questions across three tracks —
            then reveal fully-explained model answers so you learn <span className="text-[var(--color-ink)]">why</span>, not just what to say.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 items-start">
          <div>
            {/* Track previews */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
              {(Object.entries(CATS) as [Category, (typeof CATS)[Category]][]).map(([key, cfg], i) => {
                const Icon = cfg.icon
                return (
                  <motion.div
                    key={key}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: i * 0.08 }}
                    whileHover={{ y: -3 }}
                    className="glass-card-hover p-4"
                  >
                    <div
                      className="w-8 h-8 rounded-xl flex items-center justify-center mb-3"
                      style={{ backgroundColor: cfg.color + '1a' }}
                    >
                      <Icon className="w-4 h-4" style={{ color: cfg.color }} />
                    </div>
                    <div className="text-sm font-semibold text-[var(--color-ink)] mb-1">{cfg.label}</div>
                    <div className="text-xs text-[var(--color-ink-faint)] leading-relaxed">{cfg.desc}</div>
                  </motion.div>
                )
              })}
            </div>

            {/* What is covered */}
            <div className="glass-card p-5 mb-6">
              <div className="text-xs font-mono tracking-wider uppercase text-[var(--color-ink-faint)] mb-3">What this covers</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  'Basic must-know concepts explained simply',
                  'High-level architecture & system design',
                  'Why Netflix blocks screen recording (DRM)',
                  'How Spotify plays music with the screen locked',
                  'Detailed model answers with key takeaways',
                  'Track progress: Got it vs Review again',
                ].map(item => (
                  <div key={item} className="flex items-start gap-2 text-xs text-[var(--color-ink-dim)]">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[var(--color-accent)] mt-0.5 shrink-0" />
                    {item}
                  </div>
                ))}
              </div>
            </div>

            {/* Setup form */}
            <form onSubmit={handleGenerate} className="glass-card p-6 flex flex-col gap-5">
              <div>
                <label className="block text-xs font-mono tracking-wider uppercase text-[var(--color-ink-dim)] mb-2">
                  Target Role
                </label>
                <input
                  value={role}
                  onChange={e => setRole(e.target.value)}
                  placeholder="e.g. Senior Backend Engineer, Product Manager, SRE"
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-xs font-mono tracking-wider uppercase text-[var(--color-ink-dim)] mb-2">
                  Seniority Level
                </label>
                <div className="flex gap-2 flex-wrap">
                  {SENIORITIES.map(s => {
                    const active = seniority === s
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSeniority(s)}
                        className="relative px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                      >
                        {active && (
                          <motion.span
                            layoutId="seniority-pill"
                            className="absolute inset-0 rounded-xl bg-[var(--color-accent)]/15 border border-[var(--color-accent)]/30"
                            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                          />
                        )}
                        <span className={`relative z-10 ${active ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]'}`}>
                          {s}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <AnimatePresence>
                {setupError && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5 overflow-hidden"
                  >
                    {setupError}
                  </motion.div>
                )}
              </AnimatePresence>

              <button
                type="submit"
                disabled={setupLoading}
                className="btn-violet w-fit disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                {setupLoading ? (
                  <>
                    <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Generating questions...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Start Interview Prep
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Illustrative preview */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="glass-card-violet p-6 lg:sticky lg:top-6"
          >
            <div className="flex items-center justify-between mb-5">
              <span className="text-[11px] font-mono uppercase tracking-widest text-[var(--color-ink-faint)]">interview_log.txt</span>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[var(--color-ink-faint)]" />
                <span className="w-2 h-2 rounded-full bg-[var(--color-ink-faint)]" />
                <span className="w-2 h-2 rounded-full bg-[var(--color-accent)]" />
              </div>
            </div>

            <div className="text-xs font-mono text-[var(--color-ink-faint)] mb-2">Q3 · System Design</div>
            <p className="text-sm text-[var(--color-ink-subtle)] leading-relaxed mb-5">
              &ldquo;How would you design a rate limiter for a public API?&rdquo;
            </p>

            <div className="flex items-center gap-2 mb-3">
              <Lightbulb className="w-3.5 h-3.5 text-[var(--color-accent-light)]" />
              <span className="text-xs font-mono tracking-wider uppercase text-[var(--color-ink-faint)]">Model Answer</span>
            </div>
            <p className="text-sm text-[var(--color-ink-dim)] leading-relaxed">
              Use a <span className="lint-ok text-[var(--color-ink)]">token bucket algorithm backed by Redis</span> so limits stay
              consistent across replicas, instead of <span className="lint-err">a single in-memory counter</span> that
              resets on deploy.
            </p>

            <div className="mt-4">
              <div className="text-[10px] font-mono tracking-wider uppercase text-[var(--color-ink-faint)] mb-2">Key Takeaways</div>
              <ul className="space-y-1.5">
                {['Token bucket smooths bursty traffic better than fixed windows', 'Store counters in Redis for cross-instance consistency'].map((pt) => (
                  <li key={pt} className="flex items-start gap-2 text-xs text-[var(--color-ink-dim)]">
                    <span className="w-1 h-1 rounded-full bg-[var(--color-ink-faint)] mt-1.5 shrink-0" />
                    {pt}
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-6 pt-5 border-t border-[var(--color-canvas-line-soft)] flex items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border bg-[var(--color-accent)]/15 text-[var(--color-accent)] border-[var(--color-accent)]/30">
                <CheckCircle2 className="w-3 h-3" />
                Got it
              </span>
              <span className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border bg-transparent text-[var(--color-ink-dim)] border-[var(--color-canvas-line)]">
                <RefreshCw className="w-3 h-3" />
                Review again
              </span>
            </div>
          </motion.div>
        </div>
      </div>
    )
  }

  /* ── Question Screen ──────────────────────────────────────── */
  const tabQs = byCategory(activeTab)
  const tabCfg = CATS[activeTab]
  const allMastered = questions.length > 0 && gotItCount === questions.length

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-display font-semibold text-[var(--color-ink)]">{role} · {seniority}</h1>
          <p className="text-sm text-[var(--color-ink-dim)] mt-0.5">{gotItCount} / {questions.length} mastered</p>
        </div>
        <button
          onClick={reset}
          className="flex items-center gap-2 text-sm text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] border border-[var(--color-canvas-line)] hover:border-[var(--color-ink-faint)] rounded-xl px-3 py-2 transition-all"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          New session
        </button>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1.5 bg-[var(--color-canvas-line-soft)] rounded-full mb-6 overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-[var(--color-accent-dim)] to-[var(--color-accent)]"
          initial={{ width: '0%' }}
          animate={{ width: questions.length > 0 ? `${(gotItCount / questions.length) * 100}%` : '0%' }}
          transition={{ type: 'spring', stiffness: 100 }}
        />
      </div>

      <AnimatePresence>
        {allMastered && (
          <motion.div
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="glass-card-violet p-5 mb-6 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-[var(--color-accent)]/15 flex items-center justify-center shrink-0">
                <Trophy className="w-5 h-5 text-[var(--color-accent)]" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-[var(--color-ink)]">Session mastered</div>
                <div className="text-xs text-[var(--color-ink-dim)] mt-0.5">
                  You marked all {questions.length} questions &ldquo;Got it.&rdquo; Start a new session to keep sharpening.
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Category tabs */}
      <div className="flex gap-1.5 mb-6 overflow-x-auto pb-1">
        {(Object.entries(CATS) as [Category, (typeof CATS)[Category]][]).map(([key, c]) => {
          const count = byCategory(key).length
          if (count === 0) return null
          const mastered = byCategory(key).filter(q => q.status === 'got_it').length
          const Icon = c.icon
          const active = activeTab === key
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className="relative px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-colors"
            >
              {active && (
                <motion.span
                  layoutId="category-tab-pill"
                  className="absolute inset-0 rounded-xl border border-[var(--color-canvas-line)] bg-[var(--color-canvas-raise)]"
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                />
              )}
              <span className={`relative z-10 flex items-center gap-2 ${active ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)]'}`}>
                <Icon className="w-3.5 h-3.5" style={{ color: active ? c.color : undefined }} />
                {c.label}
                <span
                  className="text-xs px-1.5 py-0.5 rounded-md font-mono"
                  style={{
                    backgroundColor: active ? c.color + '1a' : `${palette.inkFaint}1a`,
                    color: active ? c.color : palette.inkFaint,
                  }}
                >
                  {mastered}/{count}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {/* Questions */}
      <div className="space-y-3">
        {tabQs.length === 0 ? (
          <div className="text-center py-16 text-[var(--color-ink-faint)] text-sm">
            No {tabCfg.label} questions in this session.
          </div>
        ) : (
          tabQs.map((q, idx) => (
            <QuestionCard
              key={q.id}
              question={q}
              index={idx + 1}
              categoryColor={tabCfg.color}
              onReveal={() => revealAnswer(q.id)}
              onGotIt={() => setQuestionStatus(q.id, 'got_it')}
              onReview={() => setQuestionStatus(q.id, 'review')}
            />
          ))
        )}
      </div>
    </div>
  )
}

/* ─── Question Card ──────────────────────────────────────────── */

function QuestionCard({
  question, index, categoryColor, onReveal, onGotIt, onReview,
}: {
  question: SessionQuestion
  index: number
  categoryColor: string
  onReveal: () => void
  onGotIt: () => void
  onReview: () => void
}) {
  const palette = useAccentPalette()
  const borderColor =
    question.status === 'got_it' ? palette.accent
    : question.status === 'review' ? '#F59E0B'
    : palette.inkFaint

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className="bg-[var(--color-canvas-raise)]/60 backdrop-blur-xl rounded-2xl overflow-hidden border transition-[border-color] duration-300"
      style={{ borderColor, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 4px 24px rgba(0,0,0,0.4)' }}
    >
      {/* Question header */}
      <div className="p-5">
        <div className="flex items-start gap-3">
          <span className="text-xs font-mono text-[var(--color-ink-faint)] mt-0.5 shrink-0 tabular-nums w-6">
            Q{index}
          </span>
          <p className="flex-1 text-sm font-medium text-[var(--color-ink)] leading-relaxed">{question.text}</p>
          <AnimatePresence mode="wait">
            {question.status === 'got_it' && (
              <motion.div key="got_it" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                <CheckCircle2 className="w-4 h-4 text-[var(--color-accent)] shrink-0 mt-0.5" />
              </motion.div>
            )}
            {question.status === 'review' && (
              <motion.div key="review" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                <RefreshCw className="w-4 h-4 text-[#F59E0B] shrink-0 mt-0.5" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {!question.revealed && (
          <div className="mt-4 ml-9 flex items-center gap-3">
            <button
              onClick={onReveal}
              disabled={question.answerLoading}
              className="inline-flex items-center gap-2 text-xs font-mono px-3 py-1.5 rounded-lg border border-[var(--color-canvas-line)] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] hover:border-[var(--color-ink-faint)] transition-all disabled:opacity-50"
            >
              {question.answerLoading ? (
                <>
                  <span
                    className="w-3 h-3 rounded-full border-2 border-[var(--color-ink-faint)] animate-spin"
                    style={{ borderTopColor: categoryColor }}
                  />
                  Loading...
                </>
              ) : (
                <>
                  <Lightbulb className="w-3 h-3" style={{ color: categoryColor }} />
                  Reveal answer
                </>
              )}
            </button>
            <span className="text-xs text-[var(--color-ink-faint)] italic">Think about it first</span>
          </div>
        )}
      </div>

      {/* Model Answer (revealed) */}
      <AnimatePresence>
        {question.revealed && question.model_answer && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="border-t border-[var(--color-canvas-line-soft)] overflow-hidden"
          >
            <div className="p-5 pt-4 bg-[var(--color-canvas)]">
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb className="w-3.5 h-3.5" style={{ color: categoryColor }} />
                <span className="text-xs font-mono tracking-wider uppercase text-[var(--color-ink-faint)]">
                  Model Answer
                </span>
              </div>

              <p className="text-sm text-[var(--color-ink-subtle)] leading-relaxed whitespace-pre-line ml-5">
                {question.model_answer}
              </p>

              {question.key_points.length > 0 && (
                <div className="mt-4 ml-5 border-l-2 border-[var(--color-canvas-line)] pl-3.5">
                  <div className="text-xs font-mono tracking-wider uppercase text-[var(--color-ink-faint)] mb-2">
                    Key Takeaways
                  </div>
                  <ul className="space-y-1.5">
                    {question.key_points.map((pt, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-[var(--color-ink-dim)]">
                        <span className="w-1 h-1 rounded-full bg-[var(--color-ink-faint)] mt-1.5 shrink-0" />
                        {pt}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Mark status buttons */}
              <div className="flex items-center gap-2 mt-5 ml-5">
                <button
                  onClick={onGotIt}
                  className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all ${
                    question.status === 'got_it'
                      ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] border-[var(--color-accent)]/30'
                      : 'bg-transparent text-[var(--color-ink-dim)] border-[var(--color-canvas-line)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/30'
                  }`}
                >
                  <CheckCircle2 className="w-3 h-3" />
                  Got it
                </button>
                <button
                  onClick={onReview}
                  className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all ${
                    question.status === 'review'
                      ? 'bg-[#F59E0B]/15 text-[#F59E0B] border-[#F59E0B]/30'
                      : 'bg-transparent text-[var(--color-ink-dim)] border-[var(--color-canvas-line)] hover:text-[#F59E0B] hover:border-[#F59E0B]/30'
                  }`}
                >
                  <RefreshCw className="w-3 h-3" />
                  Review again
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
