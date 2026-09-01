'use client'

import { useMemo, useState } from 'react'
import { GraduationCap, Search, Target } from 'lucide-react'
import { getPrepQuestions, type PrepCategory, type PrepDifficulty, type PrepQuestion } from '@/lib/apiClient'
import { INTERVIEW_CATEGORIES } from '@/lib/interviewCategories'
import { PrepQuestionCard } from '@/components/interview/PrepQuestionCard'
import { InlineError } from '@/components/resume/InlineError'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Reveal } from '@/lib/reveal'


// Same five categories Mock Interview sources its questions from — one
// vocabulary for the whole Interview Engine, not a per-feature copy.
const CATEGORIES: { value: PrepCategory; label: string }[] = INTERVIEW_CATEGORIES

const DIFFICULTIES: { value: PrepDifficulty | 'all'; label: string }[] = [
  { value: 'all', label: 'All levels' },
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
]

/**
 * AI Interview Preparation — teaches concepts, doesn't run a session.
 * Every field a question carries is visible the moment it's fetched; there
 * is no "attempt, then reveal" gate anywhere in this component, which is
 * the one hard rule that separates this from the Drills tab next to it.
 */
export function InterviewPrep({ initialRole = '' }: { initialRole?: string }) {
  const [role, setRole] = useState(initialRole)
  const [submittedRole, setSubmittedRole] = useState('')
  const [category, setCategory] = useState<PrepCategory>('technical')
  const [difficulty, setDifficulty] = useState<PrepDifficulty | 'all'>('all')
  const [search, setSearch] = useState('')
  const [questions, setQuestions] = useState<PrepQuestion[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = async (forRole: string, forCategory: PrepCategory) => {
    if (!forRole.trim()) {
      setError('Enter the role you want to prepare for.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const data = await getPrepQuestions(forRole.trim(), forCategory)
      setQuestions(data.questions)
      setSubmittedRole(forRole.trim())
    } catch {
      setError('Could not load prep questions. Check that the API is running and try again.')
    } finally {
      setLoading(false)
    }
  }

  // The first fetch is an explicit action (the Generate button) — cost-
  // conscious by default, matching Screening Prep's own pattern. Once a
  // role has been submitted once, switching categories is a fresh fetch
  // for that category (each is its own cache entry server-side) without
  // requiring the button again — the role is already known.
  const handleCategoryChange = (next: PrepCategory) => {
    setCategory(next)
    setDifficulty('all')
    setSearch('')
    if (submittedRole) load(submittedRole, next)
  }

  const filtered = useMemo(() => {
    if (!questions) return []
    const term = search.trim().toLowerCase()
    return questions.filter((q) => {
      if (difficulty !== 'all' && q.difficulty !== difficulty) return false
      if (!term) return true
      return (
        q.text.toLowerCase().includes(term) ||
        q.important_keywords.some((k) => k.toLowerCase().includes(term))
      )
    })
  }, [questions, difficulty, search])

  const completedCount = questions?.filter((q) => q.user_state?.completed).length ?? 0

  // Cards own their bookmark/completed/notes state locally (see
  // PrepQuestionCard) — this mirrors a change back into the list this
  // component holds, so aggregates like completedCount above actually
  // reflect what the user just did instead of the state at fetch time.
  const handleStateChange = (questionId: number, state: PrepQuestion['user_state']) => {
    setQuestions((prev) => prev?.map((q) => (q.id === questionId ? { ...q, user_state: state } : q)) ?? prev)
  }

  return (
    <div>
      <div className="mb-6">
        <span className="eyebrow mb-3 inline-flex">
          <GraduationCap className="w-3 h-3" />
          Interview Preparation
        </span>
        <h2 className="text-xl font-display font-medium text-(--color-ink) mb-2">
          Understand the concept, not just the question.
        </h2>
        <p className="text-sm text-(--color-ink-dim) leading-relaxed max-w-xl">
          Every question here comes with the full answer, why it&apos;s asked, and how to actually
          get better at it — nothing is hidden behind an attempt. This is for learning, not scoring.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="flex-1">
          <label htmlFor="prep-role" className="sr-only">
            Role
          </label>
          <Input
            id="prep-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') load(role, category) }}
            placeholder="e.g. Backend Engineer"
          />
        </div>
        <Button type="button" onClick={() => load(role, category)} disabled={loading} className="whitespace-nowrap">
          {loading ? 'Loading…' : submittedRole ? 'Reload' : 'Generate'}
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-5">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-pressed={category === c.value}
            onClick={() => handleCategoryChange(c.value)}
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

      {error && (
        <div className="mb-5">
          <InlineError message={error} />
        </div>
      )}

      {loading && (
        <div className="flex flex-col gap-2.5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      )}

      {!loading && questions && (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="flex-1 min-w-[180px]">
              <label htmlFor="prep-search" className="sr-only">
                Search questions
              </label>
              <Input
                id="prep-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search questions or keywords…"
                startAdornment={<Search />}
              />
            </div>
            <div className="flex gap-1.5">
              {DIFFICULTIES.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  aria-pressed={difficulty === d.value}
                  onClick={() => setDifficulty(d.value)}
                  className="chip transition-colors"
                  style={{
                    borderColor: difficulty === d.value ? 'var(--color-accent)' : 'var(--color-canvas-line)',
                    color: difficulty === d.value ? 'var(--color-accent)' : 'var(--color-ink-dim)',
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs text-(--color-ink-faint) ml-auto">
              <Target strokeWidth={1.5} className="h-3.5 w-3.5" aria-hidden="true" />
              {completedCount} of {questions.length} marked complete
            </span>
          </div>

          {filtered.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="text-sm text-(--color-ink-faint)">
                No questions match {search ? 'that search' : 'this filter'}.
              </p>
            </div>
          ) : (
            <Reveal
             
             
             
              className="flex flex-col gap-2.5"
            >
              {filtered.map((q) => (
                <Reveal
                  key={q.id}
                 
                >
                  <PrepQuestionCard question={q} onStateChange={(state) => handleStateChange(q.id, state)} />
                </Reveal>
              ))}
            </Reveal>
          )}
        </>
      )}

      {!loading && !questions && !error && (
        <div className="card p-10 text-center">
          <GraduationCap className="w-8 h-8 text-(--color-ink-faint) mx-auto mb-3" />
          <p className="text-sm text-(--color-ink-dim)">
            Enter a role and pick a category to start learning.
          </p>
        </div>
      )}
    </div>
  )
}
