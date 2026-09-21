'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle, ArrowLeft, Download, FileCode2, FileText, ScrollText, Sparkles, Wand2 } from 'lucide-react'

import {
  buildQuickTailoredResume,
  getResumeHistory,
  getTailorPreview,
  pdfBlobUrl,
  savePdfFromBase64,
  type QuickTailorResult,
  type ResumeHistoryItem,
  type TailorPreview,
} from '@/lib/apiClient'
import { useAuth } from '@/lib/AuthContext'
import { useTailorProgress, type ProgressStep } from '@/hooks/useTailorProgress'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CopyButton } from '@/components/ui/copy-button'
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
    description: 'Applying every skill and rewrite this posting supports',
  },
]

/**
 * Autonomous tailoring: the resume builds itself.
 *
 * Every skill this resume already implies or that the posting names, and
 * every bullet rewrite Claude proposes, is applied automatically — nothing
 * waits on a click. That is a deliberate departure from this page's earlier
 * tick-box acceptance gate, which existed specifically so a candidate never
 * had a skill or achievement stated on their behalf without confirming it.
 *
 * What stays from that design, because it costs nothing to keep: every
 * applied skill and rewrite is still shown, not hidden, labelled by whether
 * it came from something the resume already demonstrates or from the
 * posting alone — the second category is the one a candidate should be able
 * to defend in an interview, and this page says so rather than presenting
 * both the same way.
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
  const [building, setBuilding] = useState(false)
  const [built, setBuilt] = useState<QuickTailorResult | null>(null)
  const [view, setView] = useState<'pdf' | 'tex'>('pdf')

  const progress = useTailorProgress(STEPS)
  const { begin, finish, reset } = progress
  const loadedFor = useRef<string>('')
  const buildStarted = useRef(false)

  const fullName = user?.fullName ?? ''

  const load = useCallback(async () => {
    if (!Number.isFinite(jobId) || jobId <= 0) {
      setError('No job was specified. Open this from a job card.')
      return
    }
    reset()
    setError('')
    setPreview(null)
    setBuilt(null)
    buildStarted.current = false

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
      const data = await getTailorPreview({ job_id: jobId, analysis_id: analysisId, include_rewrites: true })
      finish('score')
      setPreview(data)
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

  // Fires once per preview, as soon as a name is available — which for a
  // signed-in user is immediately (AuthContext always derives one, falling
  // back to the email's local part). No click required.
  useEffect(() => {
    if (!preview || buildStarted.current || !fullName.trim()) return
    buildStarted.current = true

    const run = async () => {
      setBuilding(true)
      setError('')
      try {
        begin('build')
        const result = await buildQuickTailoredResume(preview.analysis_id, {
          full_name: fullName.trim(),
          target_pages: 1,
          job_id: preview.job_id,
          accepted_skills: [...preview.state_explicitly, ...preview.missing_keywords],
          bullet_overrides: preview.bullet_suggestions,
        })
        setBuilt(result)
        finish('build')
      } catch {
        finish('build', false)
        buildStarted.current = false
        setError('The resume failed to build. Your original is unchanged.')
      } finally {
        setBuilding(false)
      }
    }
    void run()
  }, [preview, fullName, begin, finish])

  // A blob URL, not state derived from one — revoked whenever it changes or
  // this unmounts, which is the only side effect involved.
  const pdfUrl = useMemo(() => (built ? pdfBlobUrl(built.pdf_base64) : null), [built])
  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    }
  }, [pdfUrl])

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

      <div className="mb-6 panel-enter">
        <span className="eyebrow mb-2 inline-flex items-center gap-1.5">
          <Wand2 strokeWidth={1.5} className="h-3 w-3" />
          Tailor
        </span>
        <h1 className="mt-2 font-display text-2xl font-medium italic text-[var(--color-ink)] md:text-3xl">
          {preview ? `${preview.job_title} at ${preview.company}.` : 'Tailoring your resume.'}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-ink-dim)]">
          Every skill your resume supports and every rewrite Claude proposes is applied
          automatically. Nothing is downloaded until it&apos;s built, and everything applied is
          listed below so you can see exactly what changed.
        </p>
      </div>

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
          <ScoreStrip preview={preview} built={built} />

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
                Applied automatically
              </div>
              <p className="mb-4 text-xs text-[var(--color-ink-faint)]">
                Nothing here waits for a tick — every item below is already in the build.
              </p>

              {!preview.has_job_description && (
                <p className="mb-4 border-l-[3px] border-[var(--color-warning)] py-1 pl-3 text-xs text-[var(--color-ink-dim)]">
                  This listing was cached without its description, so there is nothing to compare
                  against. The lists below are empty for that reason, not because your resume is
                  already a perfect match.
                </p>
              )}

              <SkillGroup
                title="Stated explicitly"
                hint="Your resume already demonstrates these — writing them down costs nothing."
                skills={preview.state_explicitly}
              />

              <SkillGroup
                title="Added because the posting named it"
                hint="Not previously stated or implied. Make sure you can defend each of these in an interview — remove any you can't."
                skills={preview.missing_keywords}
                muted
              />

              {preview.bullet_suggestions.length > 0 && (
                <div className="mt-5 space-y-3">
                  <div className="text-xs font-medium text-[var(--color-ink)]">
                    Rewritten bullets
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

          {building && !built && (
            <div className="card mt-4 flex items-center gap-3 p-6 text-sm text-[var(--color-ink-dim)]">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-accent)]/30 border-t-[var(--color-accent)]" />
              Building your tailored PDF…
            </div>
          )}

          {built && (
            <div className="card mt-4 flex flex-col p-6 panel-enter">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="eyebrow mb-1">
                    {built.fits
                      ? `Fits on ${built.page_count} page${built.page_count !== 1 ? 's' : ''}`
                      : `Came out to ${built.page_count} pages — nothing left to trim without cutting a role`}
                  </div>
                  <p className="font-mono text-[11px] text-[var(--color-ink-faint)]">
                    {built.filename}
                    {built.from_cache && ' · instant (cached)'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex rounded-md border border-[var(--color-canvas-line)] p-0.5">
                    <button
                      type="button"
                      onClick={() => setView('pdf')}
                      className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors ${
                        view === 'pdf'
                          ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)]'
                          : 'text-[var(--color-ink-dim)]'
                      }`}
                    >
                      <FileText strokeWidth={1.5} className="h-3 w-3" />
                      Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => setView('tex')}
                      className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors ${
                        view === 'tex'
                          ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)]'
                          : 'text-[var(--color-ink-dim)]'
                      }`}
                    >
                      <FileCode2 strokeWidth={1.5} className="h-3 w-3" />
                      LaTeX source
                    </button>
                  </div>
                  <Button
                    type="button"
                    onClick={() => savePdfFromBase64(built.pdf_base64, built.filename)}
                    className="whitespace-nowrap"
                  >
                    <Download strokeWidth={1.5} className="h-4 w-4" />
                    Download
                  </Button>
                </div>
              </div>

              {view === 'pdf' ? (
                pdfUrl && (
                  <iframe
                    src={pdfUrl}
                    title="Tailored resume preview"
                    className="h-[36rem] w-full rounded-md border border-[var(--color-canvas-line)]"
                  />
                )
              ) : (
                <div className="relative">
                  <CopyButton
                    value={built.tex_source}
                    label="LaTeX source"
                    className="absolute right-2 top-2 bg-[var(--color-canvas)]"
                  />
                  <pre className="max-h-[36rem] overflow-auto whitespace-pre-wrap rounded-md bg-[var(--color-canvas-deep)] p-4 font-mono text-[11px] leading-relaxed text-[var(--color-ink-dim)]">
                    {built.tex_source}
                  </pre>
                </div>
              )}

              {built.adjustments.length > 0 && (
                <div className="mt-4">
                  <div className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-ink)]">
                    <ScrollText strokeWidth={1.5} className="h-3 w-3" />
                    What we changed to fit one page
                  </div>
                  <ul className="space-y-1 text-xs text-[var(--color-ink-dim)]">
                    {built.adjustments.map((note, i) => (
                      <li key={i}>· {note}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ScoreStrip({ preview, built }: { preview: TailorPreview; built: QuickTailorResult | null }) {
  return (
    <div className="card mt-4 flex flex-wrap items-center gap-x-8 gap-y-3 p-5">
      <div>
        <div className="eyebrow mb-1">Match, before</div>
        <div className="font-display text-2xl text-[var(--color-ink)]">
          {preview.current_score !== null ? `${preview.current_score}%` : '—'}
        </div>
      </div>
      {built && built.ats_score !== null && (
        <div>
          <div className="eyebrow mb-1">Match, after</div>
          <div className="font-display text-2xl text-[var(--color-accent)]">{built.ats_score}%</div>
        </div>
      )}
      {preview.semantic_match !== null && (
        <div>
          <div className="eyebrow mb-1">Text similarity</div>
          <div className="font-display text-2xl text-[var(--color-ink)]">
            {preview.semantic_match}%
          </div>
        </div>
      )}
      <p className="max-w-md text-xs leading-relaxed text-[var(--color-ink-faint)]">
        {preview.current_score === null
          ? 'No trained model is loaded, so this resume has not been scored against this posting.'
          : built
            ? 'The "after" figure is measured on the file that was actually built, not projected in advance.'
            : 'Measured against this posting. The tailored version is being built now — its real score follows once compiled.'}
      </p>
    </div>
  )
}

function SkillGroup({
  title,
  hint,
  skills,
  muted = false,
}: {
  title: string
  hint: string
  skills: string[]
  muted?: boolean
}) {
  if (!skills.length) return null
  return (
    <div className="mb-5">
      <div className="text-xs font-medium text-[var(--color-ink)]">{title}</div>
      <p className="mb-2.5 mt-1 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">{hint}</p>
      <div className="flex flex-wrap gap-2">
        {skills.map((skill) => (
          <span
            key={skill}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
              muted
                ? 'border-[var(--color-canvas-line)] text-[var(--color-ink-dim)]'
                : 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-on-accent)]'
            }`}
          >
            {skill}
          </span>
        ))}
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
