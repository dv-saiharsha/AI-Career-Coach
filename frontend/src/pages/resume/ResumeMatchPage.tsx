import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  Download,
  FileSearch,
  FileText,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  AnalysisView,
  ChangesView,
  OutlookCard,
  QualityView,
  ScoreComparison,
  TailorProgress,
  scoreName,
} from '@/components/resume/TailorReport'
import { useAuth } from '@/context/AuthContext'
import { HttpError } from '@/lib/http'
import { cn } from '@/lib/utils'
import { resumeService } from '@/services/resumeService'
import { subscribeToScanStages } from '@/services/resumeProgressStream'
import { resumeTailorService } from '@/services/resumeTailorService'
import { jobsService } from '@/services/jobsService'
import { profileService } from '@/services/profileService'
import type { JobDetails } from '@/types/jobs'
import type { ResumeHistoryItem } from '@/types/resume'
import type {
  ResumeAutofill,
  ResumeJobMatch,
  ReviewedPreview,
  SavedTailoredResume,
  SmartTailorResult,
  TailoredResumeContent,
} from '@/types/resumeTailor'

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

type DraftTab = 'edit' | 'analysis' | 'changes' | 'quality'

// The stages the backend reports for a scan (resume_analyzer SCAN_STAGES), then
// the requirement match this page runs after it. Only real events advance the
// list: no timer pretends progress the server has not reported.
const SCAN_STEPS = [
  { key: 'extracting', label: 'Reading your resume file' },
  { key: 'checking', label: 'Verifying this is a resume' },
  { key: 'analyzing', label: 'Analyzing the job and comparing your resume' },
  { key: 'reconciling', label: 'Reconciling skills your experience implies' },
  { key: 'diagnostics', label: 'Checking formatting and bullets' },
  { key: 'matching', label: 'Matching every requirement to your evidence' },
] as const

function ScanProgress({ stage, elapsed }: { stage: string | null; elapsed: number }) {
  const current = SCAN_STEPS.findIndex((step) => step.key === stage)
  return (
    <div className="sm:col-span-2 grid gap-1.5 border-l-2 border-primary pl-3" aria-live="polite">
      {SCAN_STEPS.map((step, index) => (
        <div key={step.key} className={cn('flex items-center gap-2 text-xs', index <= current ? 'text-foreground' : 'text-muted-foreground')}>
          {index < current ? <Check className="h-3.5 w-3.5 text-success" /> : index === current ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <span className="h-3.5 w-3.5 rounded-full border border-border" />}
          {step.label}
        </div>
      ))}
      <p className="text-[11px] text-muted-foreground">
        {elapsed}s{current === -1 ? ' · waiting for the server' : ''}. A first scan against a new job takes 1–2 minutes with the local AI model.
      </p>
    </div>
  )
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof HttpError ? error.message : error instanceof Error ? error.message : fallback
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function pdfBlob(base64: string): Blob {
  const bytes = atob(base64)
  return new Blob([Uint8Array.from(bytes, (char) => char.charCodeAt(0))], { type: 'application/pdf' })
}

function toEditableContent(raw: Record<string, unknown>, sectionTitles: Record<string, string>): TailoredResumeContent {
  const list = (value: unknown) => Array.isArray(value) ? value : []
  return {
    candidate_name: str(raw.candidate_name) || 'Candidate',
    email: str(raw.email),
    phone: str(raw.phone),
    location: str(raw.location),
    linkedin: str(raw.linkedin),
    summary: str(raw.summary),
    technical_skills: list(raw.technical_skills).map(str),
    tools_skills: list(raw.tools_skills).map(str),
    skill_groups: list(raw.skill_groups).map((item) => {
      const group = item as Record<string, unknown>
      return { category: str(group.category) || 'Skills', items: list(group.items).map(str) }
    }),
    experiences: list(raw.experiences).map((item) => {
      const experience = item as Record<string, unknown>
      return {
        title: str(experience.title),
        company: str(experience.company),
        dates: str(experience.dates),
        bullets: list(experience.bullets).map(str),
      }
    }),
    projects: list(raw.projects).map((item) => {
      const project = item as Record<string, unknown>
      return { name: str(project.name), tech: str(project.tech), dates: str(project.dates), bullets: list(project.bullets).map(str) }
    }),
    education: list(raw.education).map((item) => {
      const education = item as Record<string, unknown>
      return { degree: str(education.degree), institution: str(education.institution), dates: str(education.dates) }
    }),
    certifications: list(raw.certifications).map(str),
    awards: list(raw.awards).map(str),
    publications: list(raw.publications).map(str),
    section_order: list(raw.section_order).map(str),
    section_titles: sectionTitles,
  }
}

// ── Work-in-progress persistence ─────────────────────────────────────────
// A tailoring run takes minutes; losing it to a reload or a detour to another
// job is not acceptable. One snapshot per job (or one for a pasted JD) lives in
// sessionStorage: it survives reloads and job switches within the tab, and is
// gone when the tab closes. Storage can be unavailable or full, so every
// access is guarded and the page works without it.

interface Snapshot {
  version: 1
  jobTitle: string
  company: string
  jobDescription: string
  analysisId: number | null
  match: ResumeJobMatch | null
  originalResume: ResumeAutofill | null
  draft: SmartTailorResult | null
  editedContent: TailoredResumeContent | null
  editsDirty: boolean
  preview: ReviewedPreview | null
  savedCopy: SavedTailoredResume | null
  confirmedSkills: string[]
  targetPages: 1 | 2
  design: 'faang' | 'original'
}

function snapshotKey(jobId: number | null): string {
  return `resume-match:v1:${jobId ?? 'pasted'}`
}

function loadSnapshot(jobId: number | null): Snapshot | null {
  try {
    const raw = window.sessionStorage.getItem(snapshotKey(jobId))
    const parsed = raw ? (JSON.parse(raw) as Snapshot) : null
    return parsed?.version === 1 ? parsed : null
  } catch {
    return null
  }
}

function storeSnapshot(jobId: number | null, snapshot: Snapshot): void {
  try {
    window.sessionStorage.setItem(snapshotKey(jobId), JSON.stringify(snapshot))
  } catch {
    // Quota or privacy mode: drop the PDFs and keep the edits, which matter most.
    try {
      window.sessionStorage.setItem(
        snapshotKey(jobId),
        JSON.stringify({ ...snapshot, preview: null, draft: snapshot.draft && { ...snapshot.draft, resume: { ...snapshot.draft.resume, pdf_base64: '' } } })
      )
    } catch {
      /* the page still works without persistence */
    }
  }
}

function ScorePanel({ label, score, caption }: { label: string; score: number | null; caption: string }) {
  return (
    <section className="border-t-2 border-primary pt-3" aria-label={label}>
      <p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p>
      {score == null ? (
        <p className="mt-2 font-heading text-3xl font-bold text-foreground">Unavailable</p>
      ) : (
        <p className="mt-1 font-heading text-4xl font-bold tabular-nums text-foreground">{Math.round(score)}<span className="ml-1 text-xl">%</span></p>
      )}
      <p className="mt-1 text-sm text-muted-foreground">{caption}</p>
    </section>
  )
}

/** Bullets of one role or project: edit, remove, add. */
function BulletEditor({ label, bullets, onChange }: { label: string; bullets: string[]; onChange: (bullets: string[]) => void }) {
  return (
    <div className="grid gap-2">
      {bullets.map((bullet, index) => (
        <div key={index} className="flex items-start gap-1.5">
          <Textarea
            aria-label={`Edit bullet ${index + 1} for ${label}`}
            value={bullet}
            rows={2}
            onChange={(event) => onChange(bullets.map((b, i) => (i === index ? event.target.value : b)))}
          />
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Remove bullet ${index + 1} from ${label}`}
            onClick={() => onChange(bullets.filter((_, i) => i !== index))}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" className="w-fit" onClick={() => onChange([...bullets, ''])}>
        + Add bullet
      </Button>
    </div>
  )
}

/** One item per line: certifications, awards. */
function LinesEditor({ id, label, items, onChange }: { id: string; label: string; items: string[]; onChange: (items: string[]) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label} <span className="font-normal text-muted-foreground">(one per line)</span></Label>
      <Textarea
        id={id}
        rows={Math.max(2, items.length)}
        value={items.join('\n')}
        onChange={(event) => onChange(event.target.value.split('\n'))}
      />
    </div>
  )
}

/** Keyed by job so switching jobs gives each its own state and snapshot. */
export function ResumeMatchPage() {
  const [searchParams] = useSearchParams()
  const jobId = Number(searchParams.get('jobId')) || null
  return <ResumeMatchWorkspace key={jobId ?? 'pasted'} jobId={jobId} />
}

function ResumeMatchWorkspace({ jobId }: { jobId: number | null }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const returnTo = searchParams.get('returnTo')
  const [restored] = useState(() => loadSnapshot(jobId))

  const [job, setJob] = useState<JobDetails | null>(null)
  const [jobLoading, setJobLoading] = useState(Boolean(jobId))
  const [jobError, setJobError] = useState('')
  const [jobTitle, setJobTitle] = useState(restored?.jobTitle ?? '')
  const [company, setCompany] = useState(restored?.company ?? '')
  const [jobDescription, setJobDescription] = useState(restored?.jobDescription ?? '')
  const [history, setHistory] = useState<ResumeHistoryItem[]>([])
  const [primaryResumeId, setPrimaryResumeId] = useState<number | null>(null)
  const [analysisId, setAnalysisId] = useState<number | null>(
    Number(searchParams.get('analysisId')) || restored?.analysisId || null
  )
  const [historyLoading, setHistoryLoading] = useState(true)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [match, setMatch] = useState<ResumeJobMatch | null>(restored?.match ?? null)
  const [originalResume, setOriginalResume] = useState<ResumeAutofill | null>(restored?.originalResume ?? null)
  const [analyzing, setAnalyzing] = useState(false)
  const [scanStage, setScanStage] = useState<string | null>(null)
  const [scanElapsed, setScanElapsed] = useState(0)
  const [tailoring, setTailoring] = useState(false)
  const [tailorElapsed, setTailorElapsed] = useState(0)
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<SmartTailorResult | null>(restored?.draft ?? null)
  const [editedContent, setEditedContent] = useState<TailoredResumeContent | null>(restored?.editedContent ?? null)
  // Edited since the PDF and score on screen were produced.
  const [editsDirty, setEditsDirty] = useState(restored?.editsDirty ?? false)
  const [preview, setPreview] = useState<ReviewedPreview | null>(restored?.preview ?? null)
  const [savedCopy, setSavedCopy] = useState<SavedTailoredResume | null>(restored?.savedCopy ?? null)
  const [savedCopies, setSavedCopies] = useState<SavedTailoredResume[]>([])
  const [confirmedSkills, setConfirmedSkills] = useState<string[]>(restored?.confirmedSkills ?? [])
  const [previewPdf, setPreviewPdf] = useState<Blob | null>(() => {
    const base64 = restored?.preview?.pdf_base64 || restored?.draft?.resume.pdf_base64
    return base64 ? pdfBlob(base64) : null
  })
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [targetPages, setTargetPages] = useState<1 | 2>(restored?.targetPages ?? 1)
  const [design, setDesign] = useState<'faang' | 'original'>(restored?.design ?? 'faang')
  const [tab, setTab] = useState<DraftTab>('edit')

  useEffect(() => {
    let cancelled = false
    resumeService.getHistory()
      .then((items) => {
        if (cancelled) return
        setHistory(items)
        setAnalysisId((current) => current && items.some((item) => item.id === current) ? current : items[0]?.id ?? null)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(messageFor(err, 'Could not load resume history.'))
      })
      .finally(() => { if (!cancelled) setHistoryLoading(false) })
    resumeTailorService.listSaved()
      .then((items) => { if (!cancelled) setSavedCopies(items) })
      .catch(() => undefined)
    profileService.getProfile()
      .then((profile) => { if (!cancelled) setPrimaryResumeId(profile.primary_resume_analysis_id) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!jobId) {
      setJob(null)
      setJobLoading(false)
      return
    }
    let cancelled = false
    setJobLoading(true)
    setJobError('')
    jobsService.getJob(jobId)
      .then((result) => {
        if (cancelled) return
        setJob(result)
        setJobTitle(result.title)
        setCompany(result.company)
        setJobDescription(result.description ?? '')
      })
      .catch((err: unknown) => { if (!cancelled) setJobError(messageFor(err, 'Could not load this job.')) })
      .finally(() => { if (!cancelled) setJobLoading(false) })
    return () => { cancelled = true }
  }, [jobId])

  useEffect(() => {
    if (!previewPdf) {
      setPreviewUrl(null)
      return
    }
    const objectUrl = URL.createObjectURL(previewPdf)
    setPreviewUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [previewPdf])

  useEffect(() => {
    if (!analyzing) return
    setScanElapsed(0)
    const started = Date.now()
    const timer = window.setInterval(() => setScanElapsed(Math.round((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [analyzing])

  useEffect(() => {
    if (!tailoring) return
    setTailorElapsed(0)
    const started = Date.now()
    const timer = window.setInterval(() => setTailorElapsed(Math.round((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [tailoring])

  useEffect(() => {
    storeSnapshot(jobId, {
      version: 1,
      // A listing's text is re-fetched; only a pasted job needs storing.
      jobTitle: jobId ? '' : jobTitle,
      company: jobId ? '' : company,
      jobDescription: jobId ? '' : jobDescription,
      analysisId, match, originalResume, draft, editedContent, editsDirty, preview, savedCopy,
      confirmedSkills, targetPages, design,
    })
  }, [jobId, jobTitle, company, jobDescription, analysisId, match, originalResume, draft, editedContent, editsDirty, preview, savedCopy, confirmedSkills, targetPages, design])

  const resetResults = () => {
    setMatch(null)
    setOriginalResume(null)
    setDraft(null)
    setEditedContent(null)
    setEditsDirty(false)
    setPreview(null)
    setPreviewPdf(null)
    setSavedCopy(null)
    setConfirmedSkills([])
    setError('')
  }

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const supported = /\.(pdf|docx)$/i.test(file.name)
    if (!supported) {
      setError('Unsupported file. Upload a PDF or DOCX resume.')
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('This file exceeds the 10 MB upload limit.')
      return
    }
    setSelectedFile(file)
    setAnalysisId(null)
    resetResults()
  }

  const jobParams = () => ({ jobId: jobId ?? undefined, jobTitle, company, jobDescription })

  const analyze = async () => {
    setError('')
    if (!jobId && (!jobTitle.trim() || !jobDescription.trim())) {
      setError('Enter a job title and paste the full job description to continue.')
      return
    }
    if (!jobDescription.trim()) {
      setError('The listing did not include a job description, so it cannot be analyzed.')
      return
    }
    if (!selectedFile && !analysisId) {
      setError('Select a saved resume or upload a PDF/DOCX file first.')
      return
    }
    setAnalyzing(true)
    setScanStage(null)
    let unsubscribe = () => {}
    try {
      let id = analysisId
      if (selectedFile) {
        // The scan id correlates the backend's live stage events with this scan.
        const scanId = crypto.randomUUID()
        unsubscribe = subscribeToScanStages(scanId, setScanStage)
        const scanned = await resumeService.analyzeResume(selectedFile, jobDescription, scanId)
        unsubscribe()
        id = scanned.id
        setAnalysisId(id)
        setSelectedFile(null)
        const items = await resumeService.getHistory()
        setHistory(items)
      }
      if (!id) throw new Error('Choose a resume before analyzing.')
      setScanStage('matching')
      const result = await resumeTailorService.matchResume(id, jobParams())
      resetResults()
      setMatch(result)
      try {
        setOriginalResume(await resumeTailorService.getAutofill(id))
      } catch {
        setOriginalResume(null)
      }
    } catch (err) {
      setError(messageFor(err, 'Resume analysis failed. Your selected resume and job remain available.'))
    } finally {
      unsubscribe()
      setAnalyzing(false)
      setScanStage(null)
    }
  }

  const tailor = async () => {
    if (!analysisId || !jobDescription.trim()) return
    setError('')
    setTailoring(true)
    try {
      const result = await resumeTailorService.smartTailor(analysisId, {
        ...jobParams(),
        fullName: user?.fullName ?? '',
        design,
        targetPages,
        confirmedSkills,
      })
      if (!result?.resume?.pdf_base64 || !result.analysis || !result.validation) {
        throw new Error('The tailoring service returned an incomplete result. Please try again.')
      }
      setDraft(result)
      setEditedContent(toEditableContent(result.resume.content, result.resume.section_titles))
      setEditsDirty(false)
      setPreview(null)
      setPreviewPdf(pdfBlob(result.resume.pdf_base64))
      setSavedCopy(null)
      setTab('edit')
    } catch (err) {
      setError(messageFor(err, 'Tailoring failed. Your original analysis is unchanged.'))
    } finally {
      setTailoring(false)
    }
  }

  const contentForRequest = (content: TailoredResumeContent): TailoredResumeContent => {
    const clean = (items: string[]) => items.map((item) => item.trim()).filter(Boolean)
    return {
      ...content,
      experiences: content.experiences.map((e) => ({ ...e, bullets: clean(e.bullets) })),
      projects: content.projects.map((p) => ({ ...p, bullets: clean(p.bullets) })),
      certifications: clean(content.certifications),
      awards: clean(content.awards),
      publications: clean(content.publications),
    }
  }

  const reviewedRequest = () => ({
    sourceAnalysisId: analysisId!,
    ...jobParams(),
    targetPages,
    design,
    content: contentForRequest(editedContent!),
  })

  const updatePreview = async () => {
    if (!analysisId || !editedContent) return
    setError('')
    setPreviewing(true)
    try {
      const result = await resumeTailorService.previewReviewed(reviewedRequest())
      setPreview(result)
      setPreviewPdf(pdfBlob(result.pdf_base64))
      setEditsDirty(false)
    } catch (err) {
      setError(messageFor(err, 'Could not update the preview. Your edits are still here.'))
    } finally {
      setPreviewing(false)
    }
  }

  const saveDraft = async () => {
    if (!analysisId || !editedContent) return
    setError('')
    setSaving(true)
    try {
      const result = await resumeTailorService.saveTailored(reviewedRequest())
      setSavedCopy(result)
      setSavedCopies((items) => [result, ...items.filter((item) => item.id !== result.id)])
      setEditsDirty(false)
      // Show exactly what was saved: the stored PDF, not the earlier draft.
      try {
        setPreviewPdf(await resumeTailorService.downloadSaved(result.id))
      } catch {
        /* the saved copy is still listed and downloadable */
      }
      toast.success('A separate tailored copy was saved. Your original resume is unchanged.')
    } catch (err) {
      setError(messageFor(err, 'Could not save this tailored copy. Your draft is still here.'))
    } finally {
      setSaving(false)
    }
  }

  const downloadSaved = async (id: number, filename: string) => {
    try {
      const blob = await resumeTailorService.downloadSaved(id)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (err) {
      toast.error(messageFor(err, 'Could not download this resume.'))
    }
  }

  const downloadPreview = () => {
    if (!previewUrl || !draft) return
    const link = document.createElement('a')
    link.href = previewUrl
    link.download = savedCopy?.resume_filename ?? preview?.filename ?? draft.resume.filename
    link.click()
  }

  const deleteSaved = async (id: number) => {
    try {
      await resumeTailorService.deleteSaved(id)
      setSavedCopies((items) => items.filter((item) => item.id !== id))
      if (savedCopy?.id === id) setSavedCopy(null)
      toast.success('Saved resume deleted.')
    } catch (err) {
      toast.error(messageFor(err, 'Could not delete this saved resume.'))
    }
  }

  const edit = (update: (content: TailoredResumeContent) => TailoredResumeContent) => {
    setEditedContent((current) => (current ? update(current) : current))
    setEditsDirty(true)
    setSavedCopy(null)
  }

  const resetEdits = () => {
    if (!draft) return
    setEditedContent(toEditableContent(draft.resume.content, draft.resume.section_titles))
    setPreview(null)
    setPreviewPdf(pdfBlob(draft.resume.pdf_base64))
    setEditsDirty(false)
    setSavedCopy(null)
  }

  const returnToJob = () => {
    const path = returnTo?.startsWith('/jobs/') ? returnTo : jobId ? `/jobs/${jobId}` : '/jobs'
    navigate(path, { state: location.state })
  }

  // The latest measured figures: a saved copy, else an updated preview, else
  // the generated draft. All are the same model on the same job text.
  const scoreBefore = savedCopy?.score_before ?? preview?.score_before ?? draft?.scores.before ?? match?.score ?? null
  const scoreAfter = savedCopy?.score_after ?? preview?.score_after ?? draft?.scores.after ?? null
  const scoreChange = savedCopy?.score_change ?? preview?.score_change ?? draft?.scores.change ?? null
  const scoreSource = savedCopy?.score_source ?? preview?.score_source ?? draft?.scores.source ?? match?.score_source ?? null
  const scoreCaption = savedCopy
    ? 'Measured on the saved, edited document.'
    : preview
      ? 'Measured on your edited version.'
      : 'Measured on the generated draft.'
  const pages = preview ?? draft?.resume

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground">Career workspace</p>
          <h1 className="mt-1 font-heading text-2xl font-bold text-foreground sm:text-3xl">Resume Match &amp; Optimization</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Scan a resume against one job to see its ATS score, tailor it with fact-checked changes, and save a separate copy.
          </p>
        </div>
        {jobId && <Button variant="outline" onClick={returnToJob}><ArrowLeft className="mr-2 h-4 w-4" />Return to job</Button>}
      </header>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(260px,0.7fr)]">
        <div className="grid content-start gap-5">
          <section className="border-t-2 border-primary pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground">01 · Target job</p>
                <h2 className="mt-1 font-heading text-lg font-bold text-foreground">{jobId ? 'Selected listing' : 'Choose or paste a job'}</h2>
              </div>
              {jobId && <Button variant="ghost" size="sm" onClick={() => navigate('/jobs')}>Change job <ArrowRight className="ml-1 h-4 w-4" /></Button>}
            </div>
            {jobLoading ? <Skeleton className="mt-3 h-20 w-full" /> : jobId ? (
              job ? (
                <div className="mt-3 grid gap-2 border-l-2 border-border pl-4">
                  <p className="break-words text-base font-semibold text-foreground">{job.title}</p>
                  <p className="text-sm text-muted-foreground">{[job.company, job.location, job.workMode].filter(Boolean).join(' · ')}</p>
                  {!job.description && <p className="text-sm text-destructive">The source did not provide a description. Analysis is unavailable.</p>}
                  {job.description && <p className="line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{job.description}</p>}
                </div>
              ) : <p className="mt-3 text-sm text-destructive">{jobError || 'Job unavailable.'}</p>
            ) : (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="target-job-title">Job title</Label>
                  <Input id="target-job-title" value={jobTitle} onChange={(event) => { setJobTitle(event.target.value); resetResults() }} placeholder="e.g. Senior Product Designer" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="target-company">Company <span className="font-normal text-muted-foreground">(optional)</span></Label>
                  <Input id="target-company" value={company} onChange={(event) => { setCompany(event.target.value); resetResults() }} placeholder="Company name" />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="target-job-description">Job description</Label>
                  <Textarea id="target-job-description" value={jobDescription} maxLength={20000} onChange={(event) => { setJobDescription(event.target.value); resetResults() }} rows={7} placeholder="Paste the full job description" />
                  <p className="text-right text-xs text-muted-foreground">{jobDescription.length}/20,000</p>
                </div>
              </div>
            )}
          </section>

          <section className="border-t border-border pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground">02 · Starting resume</p>
                <h2 className="mt-1 font-heading text-lg font-bold text-foreground">Select a version</h2>
              </div>
              {primaryResumeId && <Badge variant="outline">Primary is marked in the list</Badge>}
            </div>
            {historyLoading ? <Skeleton className="mt-3 h-10 w-full" /> : (
              <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="grid gap-1.5">
                  <Label htmlFor="resume-version">Saved resume scan</Label>
                  <select
                    id="resume-version"
                    value={analysisId ?? ''}
                    disabled={analyzing || tailoring || history.length === 0}
                    onChange={(event) => {
                      setAnalysisId(Number(event.target.value) || null)
                      setSelectedFile(null)
                      resetResults()
                    }}
                    className="h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">Choose a resume scan</option>
                    {history.map((item) => (
                      <option key={item.id} value={item.id}>{item.resume_filename}{item.id === primaryResumeId ? ' · Primary' : ''} · {new Date(item.created_at).toLocaleDateString()} · saved score {item.ats_score}%</option>
                    ))}
                  </select>
                  {history.length === 0 && <p className="text-xs text-muted-foreground">No saved scans yet. Upload a resume to create one.</p>}
                </div>
                <div className="grid content-end">
                  <input ref={fileRef} type="file" accept=".pdf,.docx" className="sr-only" onChange={selectFile} aria-label="Upload resume PDF or DOCX" />
                  <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={analyzing || tailoring}>
                    <FileText className="mr-2 h-4 w-4" />Upload PDF/DOCX
                  </Button>
                </div>
                {selectedFile && <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-2 border-l-2 border-primary pl-3 text-sm"><span className="truncate font-medium text-foreground">{selectedFile.name} · Ready to scan</span><Button size="sm" variant="ghost" onClick={() => setSelectedFile(null)}>Remove</Button></div>}
                {analyzing && <ScanProgress stage={scanStage} elapsed={scanElapsed} />}
                <Button className="sm:col-span-2" onClick={analyze} disabled={analyzing || tailoring || jobLoading || !jobDescription.trim()}>
                  {analyzing ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />Scanning</> : <><FileSearch className="mr-2 h-4 w-4" />Scan resume for this job</>}
                </Button>
              </div>
            )}
          </section>
        </div>

        <aside className="grid content-start gap-5 border-t border-border pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
          <section>
            <p className="text-xs font-semibold uppercase text-muted-foreground">Workflow</p>
            <ol className="mt-3 grid gap-3 text-sm">
              {[
                ['Choose job and resume', true],
                ['Scan: ATS score and gaps', Boolean(match)],
                ['Tailor, review and edit', Boolean(draft)],
                ['Save or download', Boolean(savedCopy)],
              ].map(([label, done], index) => (
                <li key={String(label)} className={cn('flex items-center gap-3', done ? 'text-foreground' : 'text-muted-foreground')}>
                  <span className={cn('grid h-7 w-7 place-items-center rounded-full border text-xs font-bold', done ? 'border-primary' : 'border-border')}>
                    {done && index > 0 ? <Check className="h-3.5 w-3.5" /> : index + 1}
                  </span>
                  {label}
                </li>
              ))}
            </ol>
          </section>
          <Alert>
            <CircleAlert className="h-4 w-4" />
            <AlertTitle>Compatibility estimate</AlertTitle>
            <AlertDescription>Scores are model estimates for this resume and job description, not a result from an employer’s ATS and not a screening guarantee.</AlertDescription>
          </Alert>
          {savedCopies.length > 0 && (
            <section className="border-t border-border pt-3">
              <h2 className="font-heading text-base font-bold text-foreground">Saved tailored copies</h2>
              <ul className="mt-2 grid gap-2">
                {savedCopies.slice(0, 4).map((item) => (
                  <li key={item.id} className="flex min-w-0 items-center justify-between gap-2 border-b border-border py-2 last:border-0">
                    <div className="min-w-0"><p className="truncate text-sm font-medium text-foreground">{item.job_title}</p><p className="truncate text-xs text-muted-foreground">{item.resume_filename} · {item.score_after == null ? 'score unavailable' : `${Math.round(item.score_after)}%`}</p></div>
                    <div className="flex shrink-0 gap-1">
                      <Button size="icon" variant="ghost" aria-label={`Download ${item.resume_filename}`} onClick={() => downloadSaved(item.id, item.resume_filename)}><Download className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" aria-label={`Delete ${item.resume_filename}`} onClick={() => deleteSaved(item.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </section>

      {error && <Alert variant="destructive"><CircleAlert className="h-4 w-4" /><AlertTitle>Couldn’t complete that step</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}

      {match && (
        <section className="grid gap-5 border-t border-border pt-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><p className="text-xs font-semibold uppercase text-muted-foreground">03 · Scan result</p><h2 className="mt-1 font-heading text-xl font-bold text-foreground">{match.resume_filename} · {match.job_title}</h2><p className="mt-1 text-sm text-muted-foreground">{match.score_label}</p></div>
            <div className="grid gap-5 sm:grid-cols-2">
              <ScorePanel label={scoreName(match.score_source)} score={match.score} caption={match.score_source === 'keyword_fallback' ? 'Your resume as it is: the share of this job\u2019s keywords it covers.' : match.score_available ? 'Your resume as it is, scored against this job.' : 'No score could be computed for this job description.'} />
              <OutlookCard title="Shortlist outlook" outlook={match.outlook} />
            </div>
          </div>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
            <div className="grid content-start gap-5">
              <section className="border-t border-border pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-heading text-base font-bold text-foreground">Requirements evidence</h3><span className="text-sm text-muted-foreground">Requirement coverage {match.requirement_coverage}%</span></div>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div><h4 className="text-sm font-semibold text-foreground">Matched or related</h4><ul className="mt-2 grid gap-2">{match.matched_requirements.length ? match.matched_requirements.map((item) => <li key={item.key} className="border-l-2 border-success pl-3 text-sm"><p className="font-medium text-foreground">{item.requirement} <span className="text-xs font-normal capitalize text-muted-foreground">· {item.importance}</span></p><p className="mt-0.5 text-xs text-muted-foreground">{item.resume_evidence || 'Evidence present'}{item.buried ? ' · appears deeper in the resume' : ''}</p></li>) : <li className="text-sm text-muted-foreground">No direct evidence found.</li>}</ul></div>
                  <div><h4 className="text-sm font-semibold text-foreground">Gaps and transferable skills</h4><ul className="mt-2 grid gap-2">{[...match.missing_requirements, ...match.transferable_requirements].length ? [...match.missing_requirements, ...match.transferable_requirements].map((item) => <li key={`${item.key}-${item.match}`} className="border-l-2 border-warning pl-3 text-sm"><p className="font-medium text-foreground">{item.requirement}</p><p className="mt-0.5 text-xs text-muted-foreground">{item.match === 'transferable' ? `Related evidence: ${item.via || 'see resume'}` : `${item.importance} priority · no direct evidence found`}</p></li>) : <li className="text-sm text-muted-foreground">No remaining gaps identified from this description.</li>}</ul></div>
                </div>
              </section>
              {match.diagnostics.parsing_readiness && (
                <section className="border-t border-border pt-3">
                  <h3 className="font-heading text-base font-bold text-foreground">Parsing and formatting</h3>
                  <p className="mt-1 text-sm text-muted-foreground">Readiness {match.diagnostics.parsing_readiness.readiness_score}/100 · {match.diagnostics.parsing_readiness.extracted_characters.toLocaleString()} characters extracted</p>
                  {match.diagnostics.parsing_readiness.formatting_warnings.length > 0 && <ul className="mt-2 grid gap-2">{match.diagnostics.parsing_readiness.formatting_warnings.map((warning, index) => <li key={`${warning.issue}-${index}`} className="text-sm"><strong className="text-foreground">{warning.issue}:</strong> <span className="text-muted-foreground">{warning.detail}</span></li>)}</ul>}
                  {match.diagnostics.parsing_readiness.is_single_column === false && <p className="mt-2 text-sm text-warning">Multiple columns were detected and may affect parsing.</p>}
                </section>
              )}
            </div>
            <section className="border-t border-border pt-3">
              <h3 className="font-heading text-base font-bold text-foreground">Recommendations</h3>
              {match.recommendations.length ? <ul className="mt-3 grid gap-3">{match.recommendations.slice(0, 8).map((item) => <li key={`${item.requirement}-${item.importance}`} className="border-l-2 border-primary pl-3"><p className="text-sm font-medium text-foreground">{item.requirement}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{item.message}</p></li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">No high-priority gaps were identified from the available job description.</p>}
              {match.missing_requirements.some((item) => item.kind === 'skill') && <div className="mt-4 border-t border-border pt-3"><p className="text-sm font-semibold text-foreground">Confirm skills you actually have</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Only selected skills with no resume evidence may be listed. Do not select a skill unless you can support it.</p><div className="mt-2 flex flex-wrap gap-2">{match.missing_requirements.filter((item) => item.kind === 'skill').map((item) => <label key={item.key} className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm"><input type="checkbox" checked={confirmedSkills.includes(item.requirement)} onChange={() => setConfirmedSkills((items) => items.includes(item.requirement) ? items.filter((skill) => skill !== item.requirement) : [...items, item.requirement])} />{item.requirement}</label>)}</div></div>}
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm"><span className="font-medium text-foreground">Layout</span><select value={design} onChange={(event) => setDesign(event.target.value as 'faang' | 'original')} className="h-10 rounded-md border border-input bg-background px-3"><option value="faang">Clean ATS format</option><option value="original">Keep my section order</option></select></label>
                <label className="grid gap-1.5 text-sm"><span className="font-medium text-foreground">Length</span><select value={targetPages} onChange={(event) => setTargetPages(Number(event.target.value) as 1 | 2)} className="h-10 rounded-md border border-input bg-background px-3"><option value={1}>1 page</option><option value={2}>2 pages</option></select></label>
              </div>
              <Button className="mt-3 w-full" onClick={tailor} disabled={tailoring || analyzing}>
                {tailoring ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />Tailoring resume</> : <><Sparkles className="mr-2 h-4 w-4" />{draft ? 'Tailor again' : 'Tailor My Resume'}</>}
              </Button>
              {draft && <p className="mt-2 text-xs text-muted-foreground">Tailoring again replaces the current draft and its unsaved edits.</p>}
              {match.score_source === 'keyword_fallback' && <p className="mt-2 text-xs text-muted-foreground">Scores here are keyword-coverage scores, measured the same way before and after tailoring, because the trained ATS model is not installed on this server.</p>}
            </section>
          </div>
        </section>
      )}

      {tailoring && (
        <section className="grid place-items-center border-t border-border py-10" aria-label="Tailoring progress">
          <TailorProgress elapsed={tailorElapsed} />
        </section>
      )}

      {draft && editedContent && !tailoring && (
        <section className="grid gap-5 border-t border-border pt-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><p className="text-xs font-semibold uppercase text-muted-foreground">04 · Tailored result</p><h2 className="mt-1 font-heading text-xl font-bold text-foreground">Tailored draft</h2><p className="mt-1 text-sm text-muted-foreground">Review every change and edit anything before saving this separate copy.</p></div>
            {draft.tailoring.ai.note && <p className="max-w-md text-xs text-warning">{draft.tailoring.ai.note}</p>}
          </div>

          <div className="grid gap-6 border-b border-border pb-5 md:grid-cols-3">
            <ScoreComparison before={scoreBefore} after={scoreAfter} change={scoreChange} afterCaption={scoreCaption} source={scoreSource} />
            <section aria-label="Job-specific resume score" className="grid content-start gap-1">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Score for this job</p>
              <p className="font-heading text-3xl font-bold tabular-nums text-foreground">{draft.analysis.coverage}<span className="ml-1 text-xl">%</span></p>
              <p className="text-xs text-muted-foreground">
                Requirement coverage: {draft.analysis.counts.exact} exact, {draft.analysis.counts.related} related, {draft.analysis.counts.transferable} transferable, {draft.analysis.counts.missing} missing. Tailoring changes how evidence is presented, never what you have, so this moves only with skills you confirm.
              </p>
            </section>
            {draft.scores.outlook_after && <OutlookCard title="Shortlist outlook after tailoring" outlook={draft.scores.outlook_after} />}
          </div>
          {editsDirty && <p className="text-xs text-warning">You have edits the score and preview don’t reflect yet. Use “Update preview” to re-score them.</p>}

          <div role="tablist" aria-label="Tailored result" className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
            {([
              ['edit', 'Review & edit'],
              ['analysis', 'Resume ↔ JD analysis'],
              ['changes', 'What changed'],
              ['quality', 'Quality check'],
            ] as [DraftTab, string][]).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn('flex-1 rounded-md px-3 py-1.5 text-xs font-bold', tab === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'analysis' && <AnalysisView result={draft} />}
          {tab === 'changes' && <ChangesView result={draft} />}
          {tab === 'quality' && <QualityView result={draft} />}

          {tab === 'edit' && (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.8fr)]">
              <div className="grid content-start gap-4">
                <div className="flex justify-end"><Button variant="outline" size="sm" onClick={resetEdits}><RotateCcw className="mr-2 h-4 w-4" />Reset edits</Button></div>
                <div className="grid items-start gap-6 lg:grid-cols-2">
                  <section className="grid content-start gap-3" aria-label="Original resume content">
                    <div><p className="text-xs font-semibold uppercase text-muted-foreground">Original</p><h3 className="mt-1 font-heading text-base font-bold text-foreground">Source resume</h3></div>
                    {originalResume?.summary && <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{originalResume.summary}</p>}
                    {originalResume?.experiences.map((experience, index) => <div key={`original-${index}`} className="border-l-2 border-border pl-3"><p className="text-sm font-semibold text-foreground">{experience.title}{experience.company ? ` · ${experience.company}` : ''}</p><p className="text-xs text-muted-foreground">{experience.dates}</p><ul className="mt-1 grid gap-1">{experience.bullets.map((bullet, bulletIndex) => <li key={bulletIndex} className="text-sm leading-5 text-muted-foreground">{bullet}</li>)}</ul></div>)}
                    {originalResume?.projects?.map((project, index) => <div key={`original-project-${index}`} className="border-l-2 border-border pl-3"><p className="text-sm font-semibold text-foreground">{project.name}{project.tech ? ` · ${project.tech}` : ''}</p><ul className="mt-1 grid gap-1">{project.bullets.map((bullet, bulletIndex) => <li key={bulletIndex} className="text-sm leading-5 text-muted-foreground">{bullet}</li>)}</ul></div>)}
                    {originalResume?.education.map((education, index) => <p key={`education-${index}`} className="text-sm text-muted-foreground">{education.degree}{education.institution ? ` · ${education.institution}` : ''}</p>)}
                    {!originalResume?.summary && !originalResume?.experiences.length && !originalResume?.education.length && <p className="text-sm text-muted-foreground">The parser could not identify structured sections in the original scan.</p>}
                  </section>
                  <section className="grid content-start gap-4" aria-label="Editable tailored resume content">
                    <div><p className="text-xs font-semibold uppercase text-primary">Revised · editable</p><h3 className="mt-1 font-heading text-base font-bold text-foreground">Tailored content</h3></div>
                    <div className="grid gap-1.5"><Label htmlFor="edited-summary">Professional summary</Label><Textarea id="edited-summary" value={editedContent.summary} onChange={(event) => edit((c) => ({ ...c, summary: event.target.value }))} rows={4} /></div>
                    {editedContent.skill_groups.length > 0 && <section className="grid gap-2"><h4 className="text-sm font-semibold text-foreground">Skills</h4>{editedContent.skill_groups.map((group, groupIndex) => <label key={groupIndex} className="grid gap-1 text-xs text-muted-foreground">{group.category}<Input aria-label={`Edit ${group.category} skills`} value={group.items.join(', ')} onChange={(event) => { const items = event.target.value.split(',').map((item) => item.trim()).filter(Boolean); edit((c) => ({ ...c, skill_groups: c.skill_groups.map((current, index) => index === groupIndex ? { ...current, items } : current) })) }} /></label>)}</section>}
                    {editedContent.experiences.length > 0 && <section className="grid gap-3"><h4 className="text-sm font-semibold text-foreground">Experience</h4>{editedContent.experiences.map((experience, experienceIndex) => <div key={experienceIndex} className="grid gap-2 border-l-2 border-border pl-3"><p className="text-sm font-semibold text-foreground">{experience.title}{experience.company ? ` · ${experience.company}` : ''}</p><BulletEditor label={experience.title || `role ${experienceIndex + 1}`} bullets={experience.bullets} onChange={(bullets) => edit((c) => ({ ...c, experiences: c.experiences.map((e, i) => i === experienceIndex ? { ...e, bullets } : e) }))} /></div>)}</section>}
                    {editedContent.projects.length > 0 && <section className="grid gap-3"><h4 className="text-sm font-semibold text-foreground">Projects</h4>{editedContent.projects.map((project, projectIndex) => <div key={projectIndex} className="grid gap-2 border-l-2 border-border pl-3"><div className="grid gap-2 sm:grid-cols-2"><Input aria-label={`Project ${projectIndex + 1} name`} value={project.name} onChange={(event) => edit((c) => ({ ...c, projects: c.projects.map((p, i) => i === projectIndex ? { ...p, name: event.target.value } : p) }))} /><Input aria-label={`Project ${projectIndex + 1} technologies`} value={project.tech} placeholder="Technologies" onChange={(event) => edit((c) => ({ ...c, projects: c.projects.map((p, i) => i === projectIndex ? { ...p, tech: event.target.value } : p) }))} /></div><BulletEditor label={project.name || `project ${projectIndex + 1}`} bullets={project.bullets} onChange={(bullets) => edit((c) => ({ ...c, projects: c.projects.map((p, i) => i === projectIndex ? { ...p, bullets } : p) }))} /></div>)}</section>}
                    {editedContent.education.length > 0 && <section className="grid gap-3"><h4 className="text-sm font-semibold text-foreground">Education</h4>{editedContent.education.map((education, educationIndex) => <div key={educationIndex} className="grid gap-2 border-l-2 border-border pl-3 sm:grid-cols-3">{(['degree', 'institution', 'dates'] as const).map((field) => <Input key={field} aria-label={`Education ${educationIndex + 1} ${field}`} placeholder={field[0].toUpperCase() + field.slice(1)} value={education[field]} className={field === 'degree' ? 'sm:col-span-3' : ''} onChange={(event) => edit((c) => ({ ...c, education: c.education.map((e, i) => i === educationIndex ? { ...e, [field]: event.target.value } : e) }))} />)}</div>)}</section>}
                    {editedContent.certifications.length > 0 && <LinesEditor id="edited-certifications" label="Certifications" items={editedContent.certifications} onChange={(certifications) => edit((c) => ({ ...c, certifications }))} />}
                    {editedContent.awards.length > 0 && <LinesEditor id="edited-awards" label="Awards" items={editedContent.awards} onChange={(awards) => edit((c) => ({ ...c, awards }))} />}
                  </section>
                </div>
              </div>
              <aside className="grid content-start gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-l-2 border-primary pl-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{savedCopy?.resume_filename ?? preview?.filename ?? draft.resume.filename}</p>
                    <p className="text-xs text-muted-foreground">{pages?.page_count} page{pages?.page_count === 1 ? '' : 's'}{pages && !pages.fits ? ' · exceeds selected page target' : ''}{savedCopy ? ' · saved copy' : preview ? ' · your edits' : ' · generated draft'}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={downloadPreview} disabled={!previewUrl}><Download className="mr-2 h-4 w-4" />Download</Button>
                </div>
                <Button variant="outline" onClick={updatePreview} disabled={!editsDirty || previewing || saving}>
                  {previewing ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />Updating preview</> : <><RefreshCw className="mr-2 h-4 w-4" />Update preview and score</>}
                </Button>
                {previewUrl && <iframe title="Tailored resume preview" src={previewUrl} className="h-[640px] w-full rounded-md border border-border bg-white" />}
                {savedCopy && !editsDirty ? (
                  <div className="grid gap-2"><p className="inline-flex items-center gap-2 text-sm font-semibold text-success"><Check className="h-4 w-4" />Saved as a separate copy</p><Button onClick={() => downloadSaved(savedCopy.id, savedCopy.resume_filename)}><Download className="mr-2 h-4 w-4" />Download final PDF</Button></div>
                ) : (
                  <Button onClick={saveDraft} disabled={saving || previewing}><Save className="mr-2 h-4 w-4" />{saving ? 'Saving reviewed copy…' : 'Save reviewed copy'}</Button>
                )}
              </aside>
            </div>
          )}
        </section>
      )}

      {job && <div className="border-t border-border pt-4"><Button variant="ghost" onClick={returnToJob}><ArrowLeft className="mr-2 h-4 w-4" />Back to {job.title}</Button></div>}
    </main>
  )
}
