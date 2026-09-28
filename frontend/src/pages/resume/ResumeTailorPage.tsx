import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clipboard,
  Copy,
  Download,
  FileSearch,
  RotateCcw,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ConicRing } from '@/components/shared/ConicRing'
import { useAuth } from '@/context/AuthContext'
import { resumeService } from '@/services/resumeService'
import { resumeTailorService } from '@/services/resumeTailorService'
import type { ResumeHistoryItem, ResumeOnFile } from '@/types/resume'
import type { BulletSuggestion, QuickTailorResult, TailorHandoff, TailorPreview } from '@/types/resumeTailor'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface NavState {
  jobTitle?: string
  company?: string
  location?: string
  workMode?: string
}

/** The paste-a-JD path: no Job Portal listing involved, so no `job_id` ever
 *  exists for this session. Real end-to-end (backend/app/schemas/
 *  resume_builder.py's QuickTailorRequestSchema.job_description is
 *  documented for exactly this "caller with no job_id" case), but gap
 *  analysis and AI bullet suggestions (tailor-handoff / tailor-preview)
 *  require a real job_id and simply can't run without one. */
interface PastedJob {
  title: string
  company: string
  description: string
}

const STEPS = ['Job selected', 'Gaps identified', 'Tailor content', 'Review & export']

function base64ToBlob(base64: string, mime: string): Blob {
  const bytes = atob(base64)
  const array = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i)
  return new Blob([array], { type: mime })
}

function companyInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?'
}

function AiBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex w-fit items-center gap-[5px] rounded-full bg-coral-tint px-[7px] py-1 text-[9px] font-extrabold uppercase tracking-[0.07em] text-coral-foreground">
      <Sparkles size={12} strokeWidth={2.4} /> {label}
    </span>
  )
}

/** Landing state when there's no job_id yet — either from Job Portal, or by
 *  pasting a posting's text in directly. Kept as one card with a divider,
 *  matching the same Card/Button/Label language as the rest of this page,
 *  rather than a separate page or a different visual system. */
function JobEntryChoice({
  onGoToJobPortal,
  onSubmitPastedJob,
}: {
  onGoToJobPortal: () => void
  onSubmitPastedJob: (job: PastedJob) => void
}) {
  const [title, setTitle] = useState('')
  const [company, setCompany] = useState('')
  const [description, setDescription] = useState('')

  const submit = () => {
    if (!title.trim() || !description.trim()) {
      toast.error('Add a role title and paste the job description.')
      return
    }
    onSubmitPastedJob({ title: title.trim(), company: company.trim(), description: description.trim() })
  }

  return (
    <Card className="mx-auto grid max-w-2xl gap-5 p-8">
      <div className="text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-primary">
          <FileSearch className="h-7 w-7" />
        </div>
        <h2 className="mt-3 text-xl font-bold text-foreground">Pick a job to tailor for</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Open a listing in Job Portal, or paste one in directly — either way works.
        </p>
      </div>

      <Button onClick={onGoToJobPortal} className="mx-auto gap-2">
        Go to Job Portal <ArrowRight className="h-4 w-4" />
      </Button>

      <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or paste a job description
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="grid gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="paste-title">Role title *</Label>
            <Input id="paste-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Senior Backend Engineer" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="paste-company">Company</Label>
            <Input id="paste-company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="paste-description">Job description *</Label>
          <Textarea
            id="paste-description"
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 20000))}
            placeholder="Paste the full posting text here…"
            className="min-h-[160px] text-xs"
          />
          <p className="text-right text-[10px] text-muted-foreground">{description.length}/20000</p>
        </div>
        <Button variant="outline" onClick={submit} className="gap-2">
          <Clipboard className="h-4 w-4" /> Continue with this description
        </Button>
      </div>
    </Card>
  )
}

export function ResumeTailorPage() {
  const [searchParams] = useSearchParams()
  const navState = (useLocation().state as NavState | null) ?? null
  const navigate = useNavigate()
  const { user } = useAuth()

  const jobId = Number(searchParams.get('jobId')) || null
  const analysisIdParam = searchParams.get('analysisId')

  const [pastedJob, setPastedJob] = useState<PastedJob | null>(null)
  const usingPastedJob = !jobId && !!pastedJob

  const [onFile, setOnFile] = useState<ResumeOnFile | null>(null)
  const [versions, setVersions] = useState<ResumeHistoryItem[]>([])
  const [analysisId, setAnalysisId] = useState<number | null>(analysisIdParam ? Number(analysisIdParam) : null)
  const [initializing, setInitializing] = useState(true)

  const [handoff, setHandoff] = useState<TailorHandoff | null>(null)
  const [handoffLoading, setHandoffLoading] = useState(false)
  const [handoffError, setHandoffError] = useState(false)

  const [acceptedSkills, setAcceptedSkills] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<TailorPreview | null>(null)
  const [generating, setGenerating] = useState(false)
  const [appliedIndexes, setAppliedIndexes] = useState<Set<number>>(new Set())

  const [targetPages, setTargetPages] = useState<1 | 2>(1)
  const [result, setResult] = useState<QuickTailorResult | null>(null)
  const [tailoring, setTailoring] = useState(false)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([resumeService.getResumeOnFile(), resumeService.getHistory()])
      .then(([info, history]) => {
        if (cancelled) return
        setOnFile(info)
        setVersions(history)
        setAnalysisId((current) => current ?? info.analysis_id ?? null)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setInitializing(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!jobId || !analysisId) {
      setHandoffLoading(false)
      return
    }
    let cancelled = false
    setHandoffLoading(true)
    setHandoffError(false)
    setHandoff(null)
    setPreview(null)
    setResult(null)
    setPdfUrl(null)
    setAcceptedSkills(new Set())
    setAppliedIndexes(new Set())
    resumeTailorService
      .getHandoff(jobId, analysisId)
      .then((data) => {
        if (!cancelled) setHandoff(data)
      })
      .catch(() => {
        if (!cancelled) setHandoffError(true)
      })
      .finally(() => {
        if (!cancelled) setHandoffLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [jobId, analysisId])

  // The job_id-gated effect above resets everything when the job changes —
  // but switching between two *pasted* descriptions never touches jobId, so
  // without this a second paste would silently keep showing the first
  // pasted job's compiled result and score.
  useEffect(() => {
    if (jobId) return
    setPreview(null)
    setResult(null)
    setPdfUrl(null)
    setAcceptedSkills(new Set())
    setAppliedIndexes(new Set())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastedJob])

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    }
  }, [pdfUrl])

  const toggleSkill = (skill: string) => {
    setAcceptedSkills((prev) => {
      const next = new Set(prev)
      if (next.has(skill)) next.delete(skill)
      else next.add(skill)
      return next
    })
  }

  const toggleSuggestion = (index: number) => {
    setAppliedIndexes((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const handleGenerateSuggestions = async () => {
    if (!jobId || !analysisId) return
    setGenerating(true)
    try {
      const data = await resumeTailorService.getPreview(jobId, analysisId, user?.fullName ?? '', true)
      setPreview(data)
      setAcceptedSkills(new Set([...data.missing_keywords, ...data.state_explicitly]))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not generate suggestions.')
    } finally {
      setGenerating(false)
    }
  }

  const handleTailor = async () => {
    if (!analysisId || !(jobId || usingPastedJob)) return
    setTailoring(true)
    try {
      const bulletOverrides: BulletSuggestion[] = (preview?.bullet_suggestions ?? []).filter((_, i) =>
        appliedIndexes.has(i)
      )
      const data = await resumeTailorService.quickTailor(analysisId, {
        fullName: user?.fullName ?? '',
        jobId: jobId ?? undefined,
        jobDescription: usingPastedJob ? pastedJob!.description : undefined,
        targetPages,
        acceptedSkills: Array.from(acceptedSkills),
        bulletOverrides,
      })
      setResult(data)
      const blob = base64ToBlob(data.pdf_base64, 'application/pdf')
      setPdfUrl(URL.createObjectURL(blob))
      toast.success('Tailored resume ready.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not generate your tailored resume.')
    } finally {
      setTailoring(false)
    }
  }

  const handleExport = () => {
    if (!pdfUrl || !result) return
    const link = document.createElement('a')
    link.href = pdfUrl
    link.download = result.filename
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  const handleCopyTex = () => {
    if (!result) return
    navigator.clipboard?.writeText(result.tex_source)
    toast.success('LaTeX source copied — paste it into Overleaf to keep editing.')
  }

  // Gap analysis (tailor-handoff) requires a real job_id and never runs in
  // paste mode — that step stays 'pending' forever there rather than
  // claiming a completion that didn't happen. Tailoring itself doesn't wait
  // on it either way: it only needs a resume and *some* job text.
  const tailorReady = usingPastedJob ? Boolean(pastedJob?.description) : Boolean(handoff)
  const stepStatuses = useMemo(() => {
    const gapsStep = !jobId || !analysisId ? 'pending' : handoffLoading ? 'active' : handoff ? 'complete' : 'pending'
    return [
      'complete',
      gapsStep,
      tailorReady && !result ? 'active' : tailorReady ? 'complete' : 'pending',
      result ? 'active' : 'pending',
    ] as const
  }, [jobId, analysisId, handoffLoading, handoff, tailorReady, result])

  const jobTitle = handoff?.job_title ?? pastedJob?.title ?? navState?.jobTitle ?? 'this role'
  const company = handoff?.company ?? pastedJob?.company ?? navState?.company ?? ''

  if (initializing) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!jobId && !pastedJob) {
    return <JobEntryChoice onGoToJobPortal={() => navigate('/jobs')} onSubmitPastedJob={setPastedJob} />
  }

  if (!onFile?.has_resume || !analysisId) {
    return (
      <Card className="mx-auto max-w-2xl space-y-4 p-10 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-primary">
          <FileSearch className="h-7 w-7" />
        </div>
        <h2 className="text-xl font-bold text-foreground">No resume on file yet</h2>
        <p className="text-sm text-muted-foreground">Analyze a resume first, then come back to tailor it for a job.</p>
        <Button onClick={() => navigate('/resume/upload')} className="gap-2">
          Analyze a resume <ArrowRight className="h-4 w-4" />
        </Button>
      </Card>
    )
  }

  return (
    <div className="grid gap-[18px]">
      <button
        onClick={() => (usingPastedJob ? setPastedJob(null) : navigate('/jobs'))}
        className="flex w-fit items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={15} /> {usingPastedJob ? 'Change job' : 'Back to job'}
      </button>

      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] bg-foreground font-heading text-sm font-extrabold text-background">
            {companyInitial(company || 'J')}
          </span>
          <div>
            <h2 className="font-heading text-xl font-bold text-foreground">Tailor resume for {jobTitle}</h2>
            {(company || navState?.location || navState?.workMode) && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {[company, navState?.location, navState?.workMode].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {result && (
            <Button variant="ghost" size="sm" onClick={handleCopyTex}>
              <Copy size={14} /> Copy LaTeX
            </Button>
          )}
          <Button onClick={handleExport} disabled={!result}>
            <Download size={16} /> Export PDF
          </Button>
        </div>
      </div>

      {/* Stepper */}
      <Card className="flex items-center gap-3 p-4">
        {STEPS.map((label, index) => (
          <div key={label} className="flex flex-1 items-center gap-3 last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={cn(
                  'grid h-7 w-7 place-items-center rounded-full border-2 text-[11px] font-bold',
                  stepStatuses[index] === 'complete' && 'border-success bg-success text-white',
                  stepStatuses[index] === 'active' && 'border-primary text-primary',
                  stepStatuses[index] === 'pending' && 'border-border text-muted-foreground'
                )}
              >
                {stepStatuses[index] === 'complete' ? <Check size={14} /> : String(index + 1).padStart(2, '0')}
              </span>
              <span className="whitespace-nowrap text-[9px] font-semibold text-muted-foreground">{label}</span>
            </div>
            {index < STEPS.length - 1 && (
              <span className={cn('h-px flex-1', stepStatuses[index] === 'complete' ? 'bg-success' : 'bg-border')} />
            )}
          </div>
        ))}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[280px_1.6fr_340px]">
        {/* Left: starting resume + gaps by domain + target role */}
        <div className="grid gap-4">
          <Card className="p-4">
            <span className="mb-2 block text-[10px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
              Starting resume
            </span>
            {versions.length > 0 ? (
              <select
                className="h-10 w-full rounded-md border border-input bg-card px-2.5 text-xs text-foreground"
                value={analysisId}
                onChange={(e) => setAnalysisId(Number(e.target.value))}
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.resume_filename}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-muted-foreground">{onFile.filename}</p>
            )}
          </Card>

          <Card className="p-4">
            <span className="mb-2 block text-[10px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
              Gaps by domain
            </span>
            {usingPastedJob ? (
              <p className="text-xs text-muted-foreground">
                Gap analysis needs a job from Job Portal — pasted descriptions skip straight to a tailored, real-scored
                resume below.
              </p>
            ) : handoffLoading ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : handoff && Object.keys(handoff.gaps_by_domain).length > 0 ? (
              <div className="grid gap-2">
                {Object.entries(handoff.gaps_by_domain).map(([domain, skills]) => (
                  <div key={domain} className="rounded-lg border border-border p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">{domain}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {skills.length}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No domain gaps found for this job.</p>
            )}
          </Card>

          <Card className="relative overflow-hidden p-4">
            <AiBadge label="Target role" />
            <h3 className="mt-2 text-[13px] font-bold text-foreground">{jobTitle}</h3>
            {company && <p className="text-[11px] text-muted-foreground">{company}</p>}
            {handoff?.original_ats_score != null && (
              <div className="mt-3 border-t border-border pt-2.5">
                <span className="text-[9px] text-muted-foreground">Original scan match</span>
                <p className="font-heading text-lg font-extrabold text-foreground">{handoff.original_ats_score}%</p>
              </div>
            )}
            {usingPastedJob ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto gap-1 p-0 text-primary"
                  onClick={() => setPastedJob(null)}
                >
                  Use a different job <ArrowRight size={13} />
                </Button>
                {pastedJob?.description && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(pastedJob.description)
                        toast.success('Job description copied to clipboard.')
                      } catch {
                        toast.error('Could not copy automatically. Select the text and copy manually.')
                      }
                    }}
                    className="flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
                  >
                    <Copy size={12} /> Copy description
                  </button>
                )}
              </div>
            ) : (
              <Button variant="ghost" size="sm" className="mt-2 h-auto gap-1 p-0 text-primary" onClick={() => navigate('/jobs')}>
                View job details <ArrowRight size={13} />
              </Button>
            )}
          </Card>
        </div>

        {/* Center: resume text / compiled preview */}
        <Card className="min-w-0 overflow-hidden bg-[#edf1f6]">
          <div className="flex h-[46px] items-center justify-between border-b border-border bg-card px-[15px] text-[9px] text-muted-foreground">
            <span className="flex items-center gap-1.5 font-bold text-foreground/80">
              <FileSearch size={15} /> {result ? 'Tailored resume preview' : 'Original resume'}
            </span>
            {result && (
              <span>
                Page 1 of {result.page_count}
                {!result.fits && ' · trimmed to fit'}
              </span>
            )}
          </div>
          <div className="flex min-h-[600px] items-center justify-center p-4">
            {handoffLoading ? (
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            ) : handoffError ? (
              <p className="max-w-xs text-center text-xs text-muted-foreground">
                Could not load this job/resume pairing. It may no longer be available.
              </p>
            ) : pdfUrl ? (
              <iframe title="Tailored resume" src={pdfUrl} className="h-[720px] w-full rounded-md border-0" />
            ) : preview ? (
              <div className="max-h-[720px] w-full overflow-y-auto whitespace-pre-wrap rounded-md bg-white p-8 font-sans text-xs leading-relaxed text-foreground shadow-sm">
                {preview.original_resume_text}
              </div>
            ) : (
              <p className="max-w-xs text-center text-xs text-muted-foreground">
                {usingPastedJob
                  ? 'Click "Generate tailored resume" to compile and preview it here.'
                  : 'Generate AI suggestions to preview your resume text here, or jump straight to tailoring.'}
              </p>
            )}
          </div>
        </Card>

        {/* Right: score + AI suggestions */}
        <div className="grid gap-4">
          <Card className="p-4">
            {result?.ats_score != null && handoff?.targeted_ats_score != null ? (
              <>
                <AiBadge label="Tailored match" />
                <div className="mt-2 flex items-center gap-3">
                  <ConicRing
                    value={result.ats_score}
                    size={72}
                    toneClassName={result.ats_score >= 75 ? 'text-success' : result.ats_score >= 50 ? 'text-warning' : 'text-destructive'}
                  >
                    <span className="font-heading text-xl font-extrabold text-foreground">{result.ats_score}</span>
                  </ConicRing>
                  <div>
                    <p className="text-xs font-bold text-foreground">
                      {result.ats_score > handoff.targeted_ats_score ? 'Improved alignment' : 'Alignment recorded'}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {result.ats_score > handoff.targeted_ats_score
                        ? `Up ${(result.ats_score - handoff.targeted_ats_score).toFixed(0)} points from your original`
                        : 'Compared with your original match below'}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5 text-xs">
                  <div>
                    <span className="block text-[9px] text-muted-foreground">Original</span>
                    <strong className="text-foreground">{handoff.targeted_ats_score}%</strong>
                  </div>
                  <ArrowRight size={16} className="text-success" />
                  <div className="text-right">
                    <span className="block text-[9px] text-muted-foreground">Tailored</span>
                    <strong className="text-success">{result.ats_score}%</strong>
                  </div>
                </div>
              </>
            ) : result?.ats_score != null ? (
              // Paste mode: no handoff/targeted_ats_score baseline exists to
              // compare against (that needs a real job_id), so this shows
              // just the one real number the compile step actually produced.
              <>
                <AiBadge label="Tailored match" />
                <div className="mt-2 flex items-center gap-3">
                  <ConicRing
                    value={result.ats_score}
                    size={72}
                    toneClassName={result.ats_score >= 75 ? 'text-success' : result.ats_score >= 50 ? 'text-warning' : 'text-destructive'}
                  >
                    <span className="font-heading text-xl font-extrabold text-foreground">{result.ats_score}</span>
                  </ConicRing>
                  <p className="text-[11px] text-muted-foreground">
                    Real score for this tailored resume against the job description you pasted.
                  </p>
                </div>
              </>
            ) : (
              <>
                <AiBadge label="Current match" />
                <div className="mt-2 flex items-center gap-3">
                  <ConicRing
                    value={handoff?.targeted_ats_score ?? 0}
                    size={72}
                    toneClassName="text-primary"
                  >
                    <span className="font-heading text-xl font-extrabold text-foreground">
                      {handoff?.targeted_ats_score ?? '—'}
                    </span>
                  </ConicRing>
                  <p className="text-[11px] text-muted-foreground">
                    Your real, compiled score appears here once you generate your tailored resume below.
                  </p>
                </div>
              </>
            )}
          </Card>

          {usingPastedJob ? (
            <Card className="p-4">
              <AiBadge label="AI suggestions" />
              <h3 className="mt-2 text-[13px] font-bold text-foreground">Not available in paste mode</h3>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Missing-skill chips and AI bullet rewrites are computed against a stored Job Portal listing — they
                need a real <code className="text-[11px]">job_id</code>, which a pasted description doesn't have.
                Tailoring itself still works below, scored for real against the text you pasted.
              </p>
              <Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={() => navigate('/jobs')}>
                Browse Job Portal instead <ArrowRight size={13} />
              </Button>
            </Card>
          ) : (
          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <AiBadge label="AI suggestions" />
                <h3 className="mt-2 text-[13px] font-bold text-foreground">High-impact edits</h3>
              </div>
            </div>

            {(handoff?.missing_keywords.length ?? 0) + (handoff?.state_explicitly.length ?? 0) > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {[...(handoff?.missing_keywords ?? []), ...(handoff?.state_explicitly ?? [])].map((skill) => (
                  <button
                    key={skill}
                    onClick={() => toggleSkill(skill)}
                    className={cn(
                      'rounded-full border px-2 py-[5px] text-[10px] font-bold transition-colors',
                      acceptedSkills.has(skill)
                        ? 'border-primary bg-secondary text-primary'
                        : 'border-border bg-card text-muted-foreground'
                    )}
                  >
                    {acceptedSkills.has(skill) ? <Check size={10} className="mr-1 inline" /> : '+ '}
                    {skill}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-3 grid border-t border-border pt-3">
              {preview ? (
                preview.bullet_suggestions.length > 0 ? (
                  preview.bullet_suggestions.map((s, index) => {
                    const applied = appliedIndexes.has(index)
                    return (
                      <div key={index} className="grid grid-cols-[1fr_auto] items-start gap-2.5 border-t border-border py-3 first:border-t-0">
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold text-foreground">{s.reason}</p>
                          <p className="mt-1 text-[10px] text-muted-foreground line-through">{s.original}</p>
                          <p className="mt-0.5 text-[10px] text-success">{s.suggested}</p>
                        </div>
                        <Button
                          variant={applied ? 'ghost' : 'outline'}
                          size="sm"
                          onClick={() => toggleSuggestion(index)}
                        >
                          {applied ? (
                            <>
                              <Check size={13} /> Applied
                            </>
                          ) : (
                            'Apply'
                          )}
                        </Button>
                      </div>
                    )
                  })
                ) : (
                  <p className="py-4 text-xs text-muted-foreground">No bullet rewrites suggested for this resume.</p>
                )
              ) : (
                <div className="grid gap-2 py-2">
                  <p className="text-xs text-muted-foreground">
                    Generate real, job-specific bullet rewrite suggestions (uses one AI credit).
                  </p>
                  <Button size="sm" onClick={handleGenerateSuggestions} disabled={generating || !handoff}>
                    {generating ? (
                      <>
                        <RotateCcw size={14} className="animate-spin" /> Generating…
                      </>
                    ) : (
                      <>
                        <Sparkles size={14} /> Generate AI suggestions
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          </Card>
          )}

          <Card className="grid gap-2.5 p-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
                Target length
              </span>
              <div className="flex overflow-hidden rounded-md border border-border">
                {[1, 2].map((n) => (
                  <button
                    key={n}
                    onClick={() => setTargetPages(n as 1 | 2)}
                    className={cn(
                      'px-2.5 py-1 text-[11px] font-bold',
                      targetPages === n ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'
                    )}
                  >
                    {n} page{n === 2 ? 's' : ''}
                  </button>
                ))}
              </div>
            </div>
            <Button onClick={handleTailor} disabled={tailoring || !tailorReady} className="w-full">
              {tailoring ? 'Compiling…' : 'Generate tailored resume'} <ArrowRight size={16} />
            </Button>
            {result && result.adjustments.length > 0 && (
              <div className="border-t border-border pt-2.5 text-[10px] text-muted-foreground">
                <p className="mb-1 font-semibold text-foreground">Adjustments made</p>
                <ul className="list-inside list-disc space-y-0.5">
                  {result.adjustments.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
