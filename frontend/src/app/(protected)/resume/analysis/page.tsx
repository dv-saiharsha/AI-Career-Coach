'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  AlertCircle,
  Check,
  Download,
  FileText,
  HelpCircle,
  Minus,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react'

import {
  downloadResumeReport,
  generateImprovedResume,
  getResumeHistory,
  getScoreBreakdown,
  type ParseCheck,
  type RubricMetric,
  type ScoreBreakdown,
} from '@/lib/apiClient'
import { useAuth } from '@/lib/AuthContext'
import { Skeleton } from '@/components/ui/skeleton'

/** Emerald 75+, amber 60-74, crimson below — mapped onto the design tokens. */
function scoreColor(score: number | null): string {
  if (score === null) return 'var(--color-ink-faint)'
  if (score >= 75) return 'var(--color-success)'
  if (score >= 60) return 'var(--color-warning)'
  return 'var(--color-danger)'
}

function bandColor(band: RubricMetric['band']): string {
  switch (band) {
    case 'EXCELLENT':
    case 'STRONG':
      return 'var(--color-success)'
    case 'GOOD':
      return 'var(--color-warning)'
    case 'NOT CHECKED':
      return 'var(--color-ink-faint)'
    default:
      return 'var(--color-danger)'
  }
}

/**
 * The scoring dashboard for one scan.
 *
 * Two figures are shown side by side rather than one, because two exist. The
 * headline comes from the trained model and is the number used everywhere
 * else in the product; the rubric total is a weighted sum of measurable
 * properties, and it is what the bars below actually decompose. Presenting
 * the bars as a breakdown of the model's score would be false — the model is
 * not a weighted sum of these seven signals — and bars that quietly failed to
 * add up to the headline would be worse than two labelled numbers.
 *
 * The compatibility section reports checks, not vendor verdicts. This product
 * has no integration with any ATS, so it cannot report that a resume passes
 * Greenhouse or Workday; what it can do is verify properties of the document,
 * and each card names the property it tested.
 */
function AnalysisDashboard() {
  const params = useSearchParams()
  const { user } = useAuth()
  const idParam = Number(params.get('id'))

  const [data, setData] = useState<ScoreBreakdown | null>(null)
  // How long the breakdown actually took to compute and return, measured
  // rather than estimated — the parse checks open the stored PDF, so this is
  // real work whose cost is worth showing.
  const [tookMs, setTookMs] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [claimed, setClaimed] = useState<Set<string>>(new Set())
  const [building, setBuilding] = useState(false)
  const [built, setBuilt] = useState(false)

  useEffect(() => {
    let cancelled = false

    // Resolving the id and fetching are both awaited before any state is
    // written, so nothing is set synchronously while the effect runs.
    const resolve = async () => {
      let analysisId = idParam
      if (!Number.isFinite(analysisId) || analysisId <= 0) {
        const history = await getResumeHistory()
        if (!history.length) throw new Error('no-scans')
        // Newest first, matching the history page.
        analysisId = history[0].id
      }
      return getScoreBreakdown(analysisId)
    }

    const startedAt = performance.now()
    resolve()
      .then((result) => {
        if (cancelled) return
        setTookMs(performance.now() - startedAt)
        setData(result)
      })
      .catch((err: Error) => {
        if (cancelled) return
        setError(
          err.message === 'no-scans'
            ? 'You have no resume scans yet.'
            : 'Could not load the breakdown. Check that the API is running.',
        )
      })

    return () => {
      cancelled = true
    }
  }, [idParam])

  const toggle = (keyword: string) =>
    setClaimed((prev) => {
      const next = new Set(prev)
      if (next.has(keyword)) next.delete(keyword)
      else next.add(keyword)
      return next
    })

  const handleAddClaimed = async () => {
    if (!data || !claimed.size) return
    setBuilding(true)
    try {
      await generateImprovedResume(
        data.analysis_id,
        user?.fullName || 'Resume',
        Array.from(claimed),
      )
      setBuilt(true)
    } catch {
      setError('Could not rebuild the resume. Your original is unchanged.')
    } finally {
      setBuilding(false)
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="card flex items-start gap-2 p-6 text-sm text-[var(--color-error)]">
          <AlertCircle strokeWidth={1.5} className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            {error}{' '}
            <Link href="/resume" className="underline">
              Scan a resume
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <Skeleton className="h-28 w-full" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 pb-28">
      {/* Headline */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="card flex flex-col items-start gap-6 p-6 sm:flex-row sm:items-center"
      >
        <ScoreGauge score={data.model_score} />
        <div className="min-w-0">
          <h1 className="font-display text-xl font-medium text-[var(--color-ink)]">
            ATS score for {data.resume_filename}
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[var(--color-ink-dim)]">
            From the trained model — the same figure used everywhere else in ApplyCenter. It
            learned from scored examples rather than a formula, so the bars below don&apos;t add up
            to it; they measure the document directly and carry their own total.
          </p>
          {data.rubric_total !== null && (
            <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
              Rubric total:{' '}
              <span className="font-mono font-semibold" style={{ color: scoreColor(data.rubric_total) }}>
                {data.rubric_total}
              </span>
              {' '}out of {data.weight_applied} points of checks that ran
              {data.skipped.length > 0 && ` — ${data.skipped.join(', ').toLowerCase()} couldn't be checked`}.
            </p>
          )}
        </div>
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Rubric */}
        <section className="card p-6">
          <div className="eyebrow mb-1">Score breakdown</div>
          <p className="mb-5 text-xs leading-relaxed text-[var(--color-ink-faint)]">
            Weighted measurements of the document. The weights are ours, chosen and documented in
            the backend — not drawn from published research.
          </p>
          <div className="space-y-4">
            {data.metrics.map((metric) => (
              <MetricBar key={metric.key} metric={metric} />
            ))}
          </div>
        </section>

        {/* Parse checks */}
        <section className="card p-6">
          <div className="eyebrow mb-1">Parse compatibility</div>
          <p className="mb-4 text-xs leading-relaxed text-[var(--color-ink-faint)]">
            ATS software doesn&apos;t score resumes — it extracts fields from them. These check
            properties of your file against the requirements parsers generally share. They
            aren&apos;t vendor tests: ApplyCenter has no integration with Greenhouse, Workday or
            any other ATS, so it can&apos;t tell you that yours passed one.
          </p>
          <div className="space-y-2.5">
            {data.parse_checks.map((check) => (
              <ParseCheckCard key={check.key} check={check} />
            ))}
          </div>
        </section>
      </div>

      {/* Missing keywords */}
      {data.missing_keywords.length > 0 && (
        <section className="card p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="eyebrow">Named by the job, missing from your resume</div>
            <span className="text-[11px] text-[var(--color-ink-faint)]">
              Tick only what you can defend in an interview.
            </span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {data.missing_keywords.map((keyword) => {
              const on = claimed.has(keyword)
              return (
                <button
                  key={keyword}
                  type="button"
                  onClick={() => toggle(keyword)}
                  aria-pressed={on}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
                    on
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-on-accent)]'
                      : 'border-[var(--color-canvas-line)] bg-[var(--color-canvas-deep)] text-[var(--color-ink-dim)] hover:border-[var(--color-line-strong)]'
                  }`}
                >
                  {on ? <Check strokeWidth={2.5} className="h-3 w-3" /> : <span>+</span>}
                  {keyword}
                </button>
              )
            })}
          </div>
          {claimed.size > 0 && (
            <button
              type="button"
              onClick={handleAddClaimed}
              disabled={building}
              className="btn-primary mt-5 inline-flex items-center gap-2 disabled:opacity-40"
            >
              {building ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-on-accent)]/30 border-t-[var(--color-on-accent)]" />
              ) : (
                <Wand2 strokeWidth={1.5} className="h-4 w-4" />
              )}
              Add {claimed.size} to my resume
            </button>
          )}
          {built && (
            <p className="mt-3 text-sm text-[var(--color-accent)]">
              Downloaded. Your original scan is untouched — re-scan the new file to see its score.
            </p>
          )}
        </section>
      )}

      <ActionBar data={data} tookMs={tookMs} />
    </div>
  )
}

function ScoreGauge({ score }: { score: number }) {
  const color = scoreColor(score)
  return (
    <div className="relative flex h-24 w-24 shrink-0 items-center justify-center">
      <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
        <path
          d="M18 2.0845a15.9155 15.9155 0 0 1 0 31.831a15.9155 15.9155 0 0 1 0-31.831"
          fill="none"
          stroke="var(--color-canvas-line)"
          strokeWidth="3"
        />
        <motion.path
          d="M18 2.0845a15.9155 15.9155 0 0 1 0 31.831a15.9155 15.9155 0 0 1 0-31.831"
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          initial={{ strokeDasharray: '0, 100' }}
          animate={{ strokeDasharray: `${Math.max(0, Math.min(100, score))}, 100` }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <span className="absolute font-display text-2xl font-semibold" style={{ color }}>
        {Math.round(score)}
      </span>
    </div>
  )
}

function MetricBar({ metric }: { metric: RubricMetric }) {
  const notChecked = metric.score === null
  const color = bandColor(metric.band)
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
        <span className="text-[var(--color-ink-dim)]">
          {metric.label}{' '}
          <span className="text-[var(--color-ink-faint)]">({metric.weight}%)</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="font-mono font-semibold text-[var(--color-ink)]">
            {notChecked ? '—' : metric.score}
          </span>
          <span
            className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
            style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}
          >
            {metric.band}
          </span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-canvas-line-soft)]">
        {/* A skipped metric renders an empty track, not a zero-width bar
            styled as failure — "not measured" is not "scored nothing". */}
        {!notChecked && (
          <motion.div
            className="h-full rounded-full"
            style={{ background: color }}
            initial={{ width: 0 }}
            animate={{ width: `${metric.score}%` }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          />
        )}
      </div>
    </div>
  )
}

function ParseCheckCard({ check }: { check: ParseCheck }) {
  const unknown = check.passed === null
  const color = unknown
    ? 'var(--color-ink-faint)'
    : check.passed
      ? 'var(--color-success)'
      : 'var(--color-danger)'

  return (
    <div className="rounded-xl border border-[var(--color-canvas-line)] p-3.5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-xs font-semibold text-[var(--color-ink)]">{check.name}</h3>
        <span
          className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold"
          style={{ color }}
        >
          {unknown ? (
            <Minus strokeWidth={3} className="h-3 w-3" />
          ) : check.passed ? (
            <Check strokeWidth={3} className="h-3 w-3" />
          ) : (
            <X strokeWidth={3} className="h-3 w-3" />
          )}
          {/* Three states, not two. A check that could not run is reported as
              such — marking it failed sends the user off to fix nothing. */}
          {unknown ? 'Not checked' : check.passed ? 'Pass' : 'Fail'}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-ink-dim)]">{check.detail}</p>
      <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
        <HelpCircle strokeWidth={1.5} className="mt-0.5 h-3 w-3 shrink-0" />
        {check.why}
      </p>
    </div>
  )
}

function ActionBar({ data, tookMs }: { data: ScoreBreakdown; tookMs: number | null }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-canvas-line)] bg-[var(--color-canvas-raise)]/90 p-3 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-canvas-deep)] text-[var(--color-ink-faint)]">
            <FileText strokeWidth={1.5} className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-[var(--color-ink)]">
              {data.resume_filename}
            </p>
            {/* No "tailored for <role> at <company>" line: a scan stores the
                job description but not the role or the employer, so that
                sentence would be filled with a placeholder presented as fact. */}
            <p className="text-[10px] text-[var(--color-ink-faint)]">
              {data.matched_keywords.length} of{' '}
              {data.matched_keywords.length + data.missing_keywords.length} job keywords matched
              {tookMs !== null && ` · analysed in ${(tookMs / 1000).toFixed(1)}s`}
            </p>
          </div>
          <span
            className="ml-1 shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold"
            style={{
              color: scoreColor(data.model_score),
              background: `color-mix(in srgb, ${scoreColor(data.model_score)} 12%, transparent)`,
            }}
          >
            {Math.round(data.model_score)}% match
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/resume" className="btn-secondary inline-flex items-center gap-1.5 text-xs">
            <Sparkles strokeWidth={1.5} className="h-3.5 w-3.5" />
            New scan
          </Link>
          <button
            type="button"
            onClick={() => downloadResumeReport(data.analysis_id, `${data.resume_filename}-report.pdf`)}
            className="btn-primary inline-flex items-center gap-1.5 text-xs"
          >
            <Download strokeWidth={1.5} className="h-3.5 w-3.5" />
            Download report
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AnalysisPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl">
          <Skeleton className="h-28 w-full" />
        </div>
      }
    >
      <AnalysisDashboard />
    </Suspense>
  )
}
