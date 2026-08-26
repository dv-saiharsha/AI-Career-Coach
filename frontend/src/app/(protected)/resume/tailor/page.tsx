'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, ArrowLeft, Check, CheckCircle2, FileText, Sparkles, Wand2 } from 'lucide-react'

import {
  generateImprovedResume,
  getResumeHistory,
  getTailorPreview,
  type ResumeHistoryItem,
  type TailorPreview,
} from '@/lib/apiClient'
import { useAuth } from '@/lib/AuthContext'
import { useTailorProgress, type ProgressStep } from '@/hooks/useTailorProgress'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { TailorProgressStepper } from '@/components/resume/TailorProgressStepper'

/**
 * Three steps, because the pipeline makes three calls.
 *
 * The tempting version has five — "optimise keyword density", "verify claims",
 * "finalise formatting" — but those happen inside one request that reports
 * nothing until it returns, so their progress would have to be invented. A
 * step that cannot fail independently is decoration, not progress.
 */
const STEPS: ProgressStep[] = [
  {
    key: 'scan',
    label: 'Reading your latest scan',
    description: 'Loading the resume you last uploaded',
  },
  {
    key: 'score',
    label: 'Scoring against this posting',
    description: 'Matching your resume to what this job asks for',
  },
  {
    key: 'build',
    label: 'Building your tailored PDF',
    description: 'Adding what you confirmed, keeping your original layout',
  },
]

/**
 * Split-view tailoring, behind an acceptance gate.
 *
 * The right pane is a proposal, not a rewrite that already happened. Nothing
 * is written until the user accepts — which is why the preview endpoint is
 * read-only and the selection lives in local state until then.
 *
 * Two things this page will not render, both of which the brief asked for and
 * neither of which can be produced honestly:
 *
 *   A projected score. The API returns none. A "+24 points" figure for a
 *   document that does not exist yet is a promise dressed as a measurement,
 *   and a candidate will read it as one. The score is recomputed for real
 *   from the built file afterwards.
 *
 *   Invented achievements. Gaps are a checklist the candidate ticks for
 *   skills they actually have, never woven silently into the proposal. A
 *   resume claiming something its owner cannot defend in an interview is
 *   worse for them than an honest gap.
 */
function TailorWorkspace() {
  const params = useSearchParams()
  const router = useRouter()
  const { user } = useAuth()

  const jobId = Number(params.get('job'))
  const analysisParam = Number(params.get('analysis'))

  const [preview, setPreview] = useState<TailorPreview | null>(null)
  const [scans, setScans] = useState<ResumeHistoryItem[] | null>(null)
  const [error, setError] = useState('')
  const [accepted, setAccepted] = useState<Set<string>>(new Set())
  // null means "the user hasn't typed anything", so the signed-in name shows
  // through as soon as the session resolves. Seeding state from an effect
  // instead would either clobber what they typed or need a guard flag.
  const [typedName, setTypedName] = useState<string | null>(null)
  const [building, setBuilding] = useState(false)
  const [built, setBuilt] = useState(false)

  const progress = useTailorProgress(STEPS)
  const { begin, finish, reset } = progress
  const loadedFor = useRef<string>('')

  const fullName = typedName ?? user?.fullName ?? ''

  const load = useCallback(async () => {
    if (!Number.isFinite(jobId) || jobId <= 0) {
      setError('No job was specified. Open this from a job card.')
      return
    }
    reset()
    setError('')
    setPreview(null)

    let analysisId = analysisParam
    try {
      begin('scan')
      const history = await getResumeHistory()
      setScans(history)
      if (!Number.isFinite(analysisId) || analysisId <= 0) {
        if (!history.length) {
          finish('scan', false)
          setError('You have no resume scans yet. Scan a resume first, then come back.')
          return
        }
        // Newest first, matching the history page, so the resume being
        // tailored is the one the user last looked at.
        analysisId = history[0].id
      }
      finish('scan')
    } catch {
      finish('scan', false)
      setError('Could not load your resumes. Check that the API is running.')
      return
    }

    try {
      begin('score')
      const data = await getTailorPreview({ job_id: jobId, analysis_id: analysisId })
      finish('score')
      setPreview(data)
      // Implied-but-unwritten skills start ticked: the candidate demonstrably
      // has them, so stating them costs nothing. Genuine gaps start unticked —
      // those are claims only the candidate can make.
      setAccepted(new Set(data.state_explicitly))
    } catch {
      finish('score', false)
      setError('Could not build a preview for this job. It may no longer be cached.')
    }
  }, [jobId, analysisParam, begin, finish, reset])

  useEffect(() => {
    const key = `${jobId}:${analysisParam}`
    if (loadedFor.current === key) return
    loadedFor.current = key
    void load()
  }, [jobId, analysisParam, load])

  const toggle = (skill: string) => {
    setAccepted((prev) => {
      const next = new Set(prev)
      if (next.has(skill)) next.delete(skill)
      else next.add(skill)
      return next
    })
  }

  const handleAccept = async () => {
    if (!preview || !fullName.trim()) return
    setBuilding(true)
    setError('')
    try {
      begin('build')
      await generateImprovedResume(
        preview.analysis_id,
        fullName.trim(),
        Array.from(accepted),
        preview.download_filename,
      )
      finish('build')
      setBuilt(true)
    } catch {
      finish('build', false)
      setError('The resume failed to build. Your original is unchanged.')
    } finally {
      setBuilding(false)
    }
  }

  const loading = !preview && !error

  return (
    <div className="mx-auto max-w-6xl">
      <button
        type="button"
        onClick={() => router.back()}
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-accent)]"
      >
        <ArrowLeft strokeWidth={1.5} className="h-3 w-3" />
        Back
      </button>

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <span className="eyebrow mb-2 inline-flex items-center gap-1.5">
          <Wand2 strokeWidth={1.5} className="h-3 w-3" />
          Tailor
        </span>
        <h1 className="mt-2 font-display text-2xl font-medium italic text-[var(--color-ink)] md:text-3xl">
          {preview ? `${preview.job_title} at ${preview.company}.` : 'Tailoring your resume.'}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-ink-dim)]">
          Your resume on the left, what we propose changing on the right. Nothing is saved or
          downloaded until you accept.
        </p>
      </motion.div>

      {STEPS.some((s) => progress.stateOf(s.key) !== 'pending') && (
        <TailorProgressStepper
          steps={STEPS}
          stateOf={progress.stateOf}
          elapsedMs={progress.elapsedMs}
        />
      )}

      {error && (
        <div className="card mt-4 flex items-start gap-2 p-5 text-sm text-[var(--color-error)]">
          <AlertCircle strokeWidth={1.5} className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            {error}
            {scans !== null && scans.length === 0 && (
              <Link href="/resume" className="ml-1 underline">
                Scan a resume
              </Link>
            )}
          </div>
        </div>
      )}

      {loading && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="card space-y-3 p-6">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-4/6" />
            </div>
          ))}
        </div>
      )}

      {preview && (
        <>
          <ScoreStrip preview={preview} />

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <section className="card flex flex-col p-6">
              <div className="eyebrow mb-1 inline-flex items-center gap-1.5">
                <FileText strokeWidth={1.5} className="h-3 w-3" />
                Your resume
              </div>
              <p className="mb-4 text-xs text-[var(--color-ink-faint)]">
                Exactly as parsed. This file is never modified.
              </p>
              <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-md bg-[var(--color-canvas-deep)] p-4 font-mono text-[11px] leading-relaxed text-[var(--color-ink-dim)]">
                {preview.original_resume_text}
              </pre>
            </section>

            <section className="card flex flex-col p-6">
              <div className="eyebrow mb-1 inline-flex items-center gap-1.5">
                <Sparkles strokeWidth={1.5} className="h-3 w-3" />
                Proposed
              </div>
              <p className="mb-4 text-xs text-[var(--color-ink-faint)]">
                Tick only what you can defend in an interview. We add nothing you have not
                confirmed.
              </p>

              {!preview.has_job_description && (
                <p className="mb-4 border-l-[3px] border-[var(--color-warning)] py-1 pl-3 text-xs text-[var(--color-ink-dim)]">
                  This listing was cached without its description, so there is nothing to compare
                  against. The lists below are empty for that reason, not because your resume is
                  already a perfect match.
                </p>
              )}

              <SkillGroup
                title="Say these out loud"
                hint="Your resume implies these but never writes them down. A keyword search still misses them, so stating them is free."
                skills={preview.state_explicitly}
                accepted={accepted}
                onToggle={toggle}
              />

              <SkillGroup
                title="Named by the posting, missing from your resume"
                hint="Neither stated nor implied. Tick only the ones you genuinely have — an untrue line costs more than a gap."
                skills={preview.missing_keywords}
                accepted={accepted}
                onToggle={toggle}
                muted
              />

              {preview.bullet_suggestions.length > 0 && (
                <div className="mt-5 space-y-3">
                  <div className="text-xs font-medium text-[var(--color-ink)]">
                    Stronger wording for your own bullets
                  </div>
                  {preview.bullet_suggestions.map((s, i) => (
                    <div key={i} className="rounded-md bg-[var(--color-canvas-deep)] p-3">
                      <p className="text-[11px] text-[var(--color-ink-faint)] line-through">
                        {s.original}
                      </p>
                      <p className="mt-1.5 text-xs text-[var(--color-ink)]">{s.suggested}</p>
                      <p className="mt-1.5 text-[11px] text-[var(--color-ink-faint)]">{s.reason}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <div className="card mt-4 p-6">
            <div className="eyebrow mb-1">Accept and build</div>
            <p className="mb-4 text-sm text-[var(--color-ink-dim)]">
              {accepted.size > 0 ? (
                <>
                  {accepted.size} skill{accepted.size !== 1 ? 's' : ''} will be added to your
                  existing skills section — same layout, same formatting, no rebuild from scratch.
                  Your score is recomputed from the real file afterwards; we do not estimate it
                  beforehand.
                </>
              ) : (
                <>Tick at least one skill on the right to build a tailored version.</>
              )}
            </p>

            <div className="flex flex-col items-start gap-3 sm:flex-row">
              <label htmlFor="tailorName" className="sr-only">
                Your full name
              </label>
              <Input
                id="tailorName"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder="Your full name (e.g. John Doe)"
                className="flex-1"
              />
              <Button
                type="button"
                onClick={handleAccept}
                disabled={building || accepted.size === 0 || !fullName.trim()}
                className="whitespace-nowrap"
              >
                {building ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-on-accent)]/30 border-t-[var(--color-on-accent)]" />
                    Building…
                  </>
                ) : (
                  <>
                    <Check strokeWidth={1.5} className="h-4 w-4" />
                    Accept changes
                  </>
                )}
              </Button>
            </div>

            <p className="mt-3 font-mono text-[11px] text-[var(--color-ink-faint)]">
              {preview.download_filename}
            </p>

            <AnimatePresence>
              {built && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-3 flex items-center gap-2 text-sm text-[var(--color-accent)]"
                >
                  <CheckCircle2 strokeWidth={1.5} className="h-4 w-4" />
                  Downloaded. Your original scan is untouched.
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </>
      )}
    </div>
  )
}

function ScoreStrip({ preview }: { preview: TailorPreview }) {
  return (
    <div className="card mt-4 flex flex-wrap items-center gap-x-8 gap-y-3 p-5">
      <div>
        <div className="eyebrow mb-1">Match, this posting</div>
        <div className="font-display text-2xl text-[var(--color-ink)]">
          {preview.current_score !== null ? `${preview.current_score}%` : '—'}
        </div>
      </div>
      {preview.semantic_match !== null && (
        <div>
          <div className="eyebrow mb-1">Text similarity</div>
          <div className="font-display text-2xl text-[var(--color-ink)]">
            {preview.semantic_match}%
          </div>
        </div>
      )}
      {/* No "after" figure sits beside these on purpose. See the component
          docstring: the API returns none, because none has been measured. */}
      <p className="max-w-md text-xs leading-relaxed text-[var(--color-ink-faint)]">
        {preview.current_score === null
          ? 'No trained model is loaded, so this resume has not been scored against this posting.'
          : 'Measured against this posting, not the one you originally scanned against. There is deliberately no projected score — a number for a resume that does not exist yet cannot be measured.'}
      </p>
    </div>
  )
}

function SkillGroup({
  title,
  hint,
  skills,
  accepted,
  onToggle,
  muted = false,
}: {
  title: string
  hint: string
  skills: string[]
  accepted: Set<string>
  onToggle: (s: string) => void
  muted?: boolean
}) {
  if (!skills.length) return null
  return (
    <div className="mb-5">
      <div className="text-xs font-medium text-[var(--color-ink)]">{title}</div>
      <p className="mb-2.5 mt-1 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">{hint}</p>
      <div className="flex flex-wrap gap-2">
        {skills.map((skill) => {
          const on = accepted.has(skill)
          return (
            <button
              key={skill}
              type="button"
              onClick={() => onToggle(skill)}
              aria-pressed={on}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                on
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-on-accent)]'
                  : `border-[var(--color-canvas-line)] text-[var(--color-ink-dim)] hover:border-[var(--color-accent)] ${
                      muted ? 'bg-transparent' : 'bg-[var(--color-canvas-deep)]'
                    }`
              }`}
            >
              {on && <Check strokeWidth={2} className="h-3 w-3" />}
              {skill}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function TailorPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl">
          <Skeleton className="h-40 w-full" />
        </div>
      }
    >
      <TailorWorkspace />
    </Suspense>
  )
}
