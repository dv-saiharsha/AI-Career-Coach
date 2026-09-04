'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle, Download, FileText, Mail, Sparkles } from 'lucide-react'

import {
  generateCoverLetter,
  getResumeHistory,
  pdfBlobUrl,
  type CoverLetter,
  type CoverLetterTone,
} from '@/lib/apiClient'
import { useAuth } from '@/lib/AuthContext'
import { PageHeader } from '@/components/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { CopyButton } from '@/components/ui/copy-button'

const TONES: { key: CoverLetterTone; label: string; hint: string }[] = [
  { key: 'professional', label: 'Professional', hint: 'Measured and plain' },
  { key: 'confident', label: 'Confident', hint: 'Direct, no hedging' },
  { key: 'concise', label: 'Concise', hint: 'Three short paragraphs' },
]

/**
 * Cover letter studio.
 *
 * A cover letter is the most dangerous document this product generates: a
 * resume bullet is anchored to a role and a date, and a cover letter
 * paragraph is anchored to nothing. So two things are visible here that the
 * spec did not ask for, and both matter more than the layout:
 *
 *   Every figure in the letter is checked against the resume, and any that
 *   does not appear is listed. The candidate has to defend these numbers in
 *   an interview, so a rounded-up percentage is worth seeing before they
 *   send it.
 *
 *   Generation is a button, never an effect. It costs a Claude call — about
 *   $0.017 — and a page that spends money on mount is a page that spends it
 *   on every refresh.
 */
function CoverLetterStudio() {
  const params = useSearchParams()
  const { user } = useAuth()

  const jobId = Number(params.get('job'))
  const analysisParam = Number(params.get('analysis'))

  const [tone, setTone] = useState<CoverLetterTone>('professional')
  const [letter, setLetter] = useState<CoverLetter | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Blob URLs leak until revoked, and regenerating with a new tone creates a
  // fresh one each time.
  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    }
  }, [pdfUrl])

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current)
  }, [])

  const handleGenerate = async () => {
    if (!Number.isFinite(jobId) || jobId <= 0) {
      setError('No job was specified. Open this from a job card.')
      return
    }
    setLoading(true)
    setError('')
    setElapsed(0)
    // Real wall-clock seconds, started when the request goes out and stopped
    // when it returns — not a script that finishes on schedule regardless.
    const startedAt = performance.now()
    timer.current = setInterval(
      () => setElapsed(Math.floor((performance.now() - startedAt) / 1000)),
      250,
    )

    try {
      let analysisId = analysisParam
      if (!Number.isFinite(analysisId) || analysisId <= 0) {
        const history = await getResumeHistory()
        if (!history.length) throw new Error('no-scans')
        analysisId = history[0].id
      }

      const result = await generateCoverLetter({
        job_id: jobId,
        analysis_id: analysisId,
        full_name: user?.fullName,
        tone,
      })
      setLetter(result)
      if (pdfUrl) URL.revokeObjectURL(pdfUrl)
      setPdfUrl(result.pdf_base64 ? pdfBlobUrl(result.pdf_base64) : null)
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      /* Prefer the server's own message. This branch used to hardcode
         "isn't configured on this server" for every 503, which was true for
         the one cause it was written against — a missing API key — and wrong
         for the rest. When the account ran out of credits the server said so
         accurately and this line replaced it with a deployment error the
         user could do nothing with. The API owns the reason; the copy below
         is only for the cases the client genuinely knows better. */
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const fromServer = typeof detail === 'string' && detail ? detail : null

      setError(
        (err as Error).message === 'no-scans'
          ? 'You have no resume scans yet. Scan a resume first.'
          : fromServer ??
            (status === 503 || status === 429
              ? 'Cover letter generation is unavailable right now. Please try again shortly.'
              : 'Could not generate the letter. Nothing was charged if it failed before the model ran.'),
      )
    } finally {
      if (timer.current) clearInterval(timer.current)
      setLoading(false)
    }
  }

  const fullText = letter?.paragraphs.join('\n\n') ?? ''

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader
        eyebrow="Cover letter"
        eyebrowIcon={Mail}
        title={letter ? `${letter.job_title} at ${letter.company}.` : 'Write a targeted letter.'}
        description={
          <>
            Written from your resume and this posting. It won&apos;t claim a number your resume
            doesn&apos;t contain — and anything it does assert that we can&apos;t find in your
            resume is listed underneath, so you see it before a recruiter does.
          </>
        }
      />

      <div className="card p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="eyebrow mb-2">Tone</div>
            <div className="flex flex-wrap gap-2">
              {TONES.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setTone(option.key)}
                  aria-pressed={tone === option.key}
                  className={`rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
                    tone === option.key
                      ? 'border-(--color-accent) bg-(--color-accent) text-(--color-on-accent)'
                      : 'border-(--color-canvas-line) bg-(--color-canvas-deep) text-(--color-ink-dim) hover:border-(--color-line-strong)'
                  }`}
                >
                  <span className="block font-medium">{option.label}</span>
                  <span className="mt-0.5 block text-[10px] opacity-70">{option.hint}</span>
                </button>
              ))}
            </div>
            {/* Tone changes register, not content. Saying so here stops
                "confident" being read as "claim more". */}
            <p className="mt-2 text-[11px] text-(--color-ink-faint)">
              Tone changes how it reads, never what it claims.
            </p>
          </div>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading}
            className="btn-primary inline-flex items-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-(--color-on-accent)/30 border-t-(--color-on-accent)" />
            ) : (
              <Sparkles strokeWidth={1.5} className="h-4 w-4" />
            )}
            {loading ? `Writing… ${elapsed}s` : letter ? 'Rewrite' : 'Write my letter'}
          </button>
        </div>
      </div>

      {error && (
        <div className="card flex items-start gap-2 p-5 text-sm text-(--color-error)">
          <AlertCircle strokeWidth={1.5} className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            {error}{' '}
            <Link href="/jobs" className="underline">
              Browse jobs
            </Link>
          </div>
        </div>
      )}

      {loading && !letter && (
        <div className="card space-y-3 p-6">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-9/12" />
        </div>
      )}

      {letter && (
        <>
          {letter.unsupported_claims.length > 0 && (
            <div className="card border-l-[3px] border-l-(--color-warning) p-5">
              <div className="eyebrow mb-1.5">Check these before you send</div>
              <p className="text-xs leading-relaxed text-(--color-ink-dim)">
                These figures appear in the letter but not in your resume:{' '}
                <span className="font-mono font-semibold text-(--color-ink)">
                  {letter.unsupported_claims.join(', ')}
                </span>
                . That may be fine — your resume might phrase it differently — but you&apos;ll be
                asked to back them up, so read those lines before sending.
              </p>
            </div>
          )}

          <div className="card p-6">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-(--color-canvas-line) pb-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-(--color-ink)">
                  {letter.job_title} — {letter.company}
                </p>
                <p className="mt-0.5 truncate font-mono text-[10px] text-(--color-ink-faint)">
                  {letter.download_filename}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <CopyButton value={fullText} />
                {pdfUrl && (
                  <a
                    href={pdfUrl}
                    download={letter.download_filename}
                    className="btn-primary inline-flex items-center gap-1.5 text-xs"
                  >
                    <Download strokeWidth={1.5} className="h-3.5 w-3.5" />
                    Download PDF
                  </a>
                )}
              </div>
            </div>

            <div className="space-y-3.5">
              {letter.paragraphs.map((paragraph, i) => (
                <p key={i} className="text-sm leading-relaxed text-(--color-ink-dim)">
                  {paragraph}
                </p>
              ))}
            </div>

            {!pdfUrl && (
              <p className="mt-4 flex items-start gap-2 text-xs text-(--color-ink-faint)">
                <FileText strokeWidth={1.5} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                This server has no LaTeX toolchain, so there&apos;s no PDF — the text above is the
                full letter and can be copied straight out.
              </p>
            )}
          </div>

          {letter.grounded_in.length > 0 && (
            <div className="card p-5">
              <div className="eyebrow mb-2">What each claim rests on</div>
              <ul className="space-y-1.5">
                {letter.grounded_in.map((quote, i) => (
                  <li key={i} className="text-[11px] leading-relaxed text-(--color-ink-faint)">
                    — {quote}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function CoverLetterPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-4xl">
          <Skeleton className="h-40 w-full" />
        </div>
      }
    >
      <CoverLetterStudio />
    </Suspense>
  )
}
