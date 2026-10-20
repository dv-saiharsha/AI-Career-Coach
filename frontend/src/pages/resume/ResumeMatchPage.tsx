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
  Maximize2,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  ZoomIn,
  ZoomOut,
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

type DraftTab = 'preview' | 'edit' | 'analysis' | 'changes' | 'quality'

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
  const compact: Snapshot = {
    ...snapshot,
    preview: snapshot.preview ? { ...snapshot.preview, pdf_base64: '' } : null,
    draft: snapshot.draft
      ? { ...snapshot.draft, resume: { ...snapshot.draft.resume, pdf_base64: '' } }
      : null,
  }
  try {
    window.sessionStorage.setItem(snapshotKey(jobId), JSON.stringify(compact))
  } catch {
    // Storage can be unavailable in privacy mode; the page still works without persistence.
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
  const [setupOpen, setSetupOpen] = useState(() => !restored?.match)
  const [analysisExpanded, setAnalysisExpanded] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)

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
  const [tab, setTab] = useState<DraftTab>('preview')
  const [previewZoom, setPreviewZoom] = useState<number | 'fit'>(100)

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
    if (!savedCopy || previewPdf || editsDirty) return
    let cancelled = false
    resumeTailorService.downloadSaved(savedCopy.id)
      .then((blob) => { if (!cancelled) setPreviewPdf(blob) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [savedCopy, previewPdf, editsDirty])

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
    const timer = window.setTimeout(() => {
      storeSnapshot(jobId, {
        version: 1,
        // A listing's text is re-fetched; only a pasted job needs storing.
        jobTitle: jobId ? '' : jobTitle,
        company: jobId ? '' : company,
        jobDescription: jobId ? '' : jobDescription,
        analysisId, match, originalResume, draft, editedContent, editsDirty, preview, savedCopy,
        confirmedSkills, targetPages, design,
      })
    }, 350)
    return () => window.clearTimeout(timer)
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
      setSetupOpen(false)
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
      const [result, original] = await Promise.all([
        resumeTailorService.smartTailor(analysisId, {
          ...jobParams(),
          fullName: user?.fullName ?? '',
          design,
          targetPages,
          confirmedSkills,
        }),
        resumeTailorService.getAutofill(analysisId).catch(() => null),
      ])
      if (!result?.resume?.pdf_base64 || !result.analysis || !result.validation) {
        throw new Error('The tailoring service returned an incomplete result. Please try again.')
      }
      setDraft(result)
      setOriginalResume(original)
      setEditedContent(toEditableContent(result.resume.content, result.resume.section_titles))
      setEditsDirty(false)
      setPreview(null)
      setPreviewPdf(pdfBlob(result.resume.pdf_base64))
      setSavedCopy(null)
      setTab('preview')
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
          <p className="text-xs font-semibold uppercase text-muted-foreground">Resume workspace</p>
          <h1 className="mt-1 font-heading text-2xl font-bold text-foreground sm:text-3xl">Tailor your resume for the role</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Choose a job and resume. We’ll compare the evidence, tailor the content, and let you review a separate copy.
          </p>
        </div>
        {jobId && <Button variant="outline" onClick={returnToJob}><ArrowLeft className="mr-2 h-4 w-4" />Return to job</Button>}
      </header>

      <ol className="grid grid-cols-4 gap-2 border-b border-border pb-4 text-xs sm:gap-4">
        {[
          ['Select', !match],
          ['Analyze', Boolean(match)],
          ['Review', Boolean(draft)],
          ['Download', Boolean(savedCopy)],
        ].map(([label, current], index) => (
          <li key={String(label)} className={cn('flex items-center gap-2', current ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
            <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[10px]', current ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>
              {index + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>

      {setupOpen ? <section className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(260px,0.7fr)]">
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
                  {analyzing ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />Analyzing match</> : <><FileSearch className="mr-2 h-4 w-4" />Analyze resume</>}
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
      </section> : match ? (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card p-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Selected for this match</p>
            <p className="mt-1 truncate text-sm font-semibold text-foreground">{match.job_title}{match.company ? ` · ${match.company}` : ''}</p>
            <p className="mt-1 truncate text-xs text-muted-foreground">{match.resume_filename}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setSetupOpen(true)}>Change selection</Button>
        </section>
      ) : null}

      {error && <Alert variant="destructive"><CircleAlert className="h-4 w-4" /><AlertTitle>Couldn’t complete that step</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}

      {match && (
        <section className="grid gap-5 border-t border-border pt-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground">Resume match estimate</p>
              <h2 className="mt-1 font-heading text-2xl font-bold text-foreground">
                {match.score != null ? `${Math.round(match.score)}% match` : match.requirement_coverage >= 70 ? 'Strong match' : match.requirement_coverage >= 40 ? 'Moderate match' : 'Needs improvement'}
              </h2>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Based on skills and qualifications found in your resume and this job description. This is an internal compatibility estimate, not an employer’s ATS result.
              </p>
            </div>
            {match.score != null && <ScorePanel label={scoreName(match.score_source)} score={match.score} caption={match.score_source === 'keyword_fallback' ? 'Keyword coverage estimate for this job.' : 'Model estimate for this resume and job.'} />}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {[
              { title: 'Strong matches', count: match.matched_requirements.length, rows: match.matched_requirements, tone: 'border-success/40' },
              { title: 'Transferable experience', count: match.transferable_requirements.length, rows: match.transferable_requirements, tone: 'border-warning/40' },
              { title: 'Not found in resume', count: match.missing_requirements.length, rows: match.missing_requirements, tone: 'border-border' },
            ].map((group) => (
              <section key={group.title} className={cn('rounded-lg border bg-card p-4', group.tone)}>
                <p className="text-sm font-semibold text-foreground">{group.title}</p>
                <p className="mt-1 font-heading text-2xl font-bold text-foreground">{group.count} <span className="text-sm font-medium text-muted-foreground">qualifications</span></p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {group.rows.slice(0, 5).map((item) => <Badge key={item.key} variant="outline" className="font-normal">{item.requirement}</Badge>)}
                  {group.rows.length === 0 && <span className="text-xs text-muted-foreground">No items identified</span>}
                  {group.rows.length > 5 && <span className="px-1 py-1 text-xs text-muted-foreground">+{group.rows.length - 5} more</span>}
                </div>
              </section>
            ))}
          </div>

          <details open={analysisExpanded} onToggle={(event) => setAnalysisExpanded(event.currentTarget.open)} className="rounded-lg border border-border bg-card p-4">
            <summary className="cursor-pointer text-sm font-semibold text-foreground">View detailed analysis</summary>
            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              <section>
                <h3 className="text-sm font-semibold text-foreground">Requirement evidence</h3>
                <ul className="mt-2 grid gap-2">
                  {[...match.matched_requirements, ...match.transferable_requirements, ...match.missing_requirements].map((item) => (
                    <li key={item.key} className="border-l-2 border-border pl-3 text-sm">
                      <p className="font-medium text-foreground">{item.requirement} <span className="text-xs font-normal capitalize text-muted-foreground">· {item.match} · {item.importance}</span></p>
                      {item.resume_evidence && <p className="mt-0.5 text-xs text-muted-foreground">{item.resume_evidence}</p>}
                      {item.match === 'transferable' && <p className="mt-0.5 text-xs text-muted-foreground">Related evidence: {item.via || 'see resume'}</p>}
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h3 className="text-sm font-semibold text-foreground">Formatting and recommendations</h3>
                {match.diagnostics.parsing_readiness && <p className="mt-2 text-xs text-muted-foreground">Formatting readiness {match.diagnostics.parsing_readiness.readiness_score}/100{match.diagnostics.parsing_readiness.is_single_column === false ? ' · multiple columns detected' : ''}</p>}
                <ul className="mt-2 grid gap-2">{match.recommendations.slice(0, 8).map((item) => <li key={`${item.requirement}-${item.importance}`} className="text-sm"><strong className="font-medium text-foreground">{item.requirement}</strong><p className="text-xs text-muted-foreground">{item.message}</p></li>)}</ul>
              </section>
            </div>
          </details>

          {match.missing_requirements.some((item) => item.kind === 'skill') && (
            <details className="rounded-lg border border-border p-4">
              <summary className="cursor-pointer text-sm font-semibold text-foreground">Skills to confirm <span className="font-normal text-muted-foreground">· optional</span></summary>
              <p className="mt-2 text-xs text-muted-foreground">Only confirm skills you can support with real experience. Confirmed skills may appear in the skills section, never as invented experience.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {match.missing_requirements.filter((item) => item.kind === 'skill').map((item) => (
                  <label key={item.key} className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm">
                    <input type="checkbox" checked={confirmedSkills.includes(item.requirement)} onChange={() => setConfirmedSkills((items) => items.includes(item.requirement) ? items.filter((skill) => skill !== item.requirement) : [...items, item.requirement])} />
                    I have {item.requirement}
                  </label>
                ))}
              </div>
            </details>
          )}

          <details open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)} className="rounded-lg border border-border p-4">
            <summary className="cursor-pointer text-sm font-semibold text-foreground">Advanced options</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm"><span className="font-medium text-foreground">Resume style</span><select value={design} onChange={(event) => setDesign(event.target.value as 'faang' | 'original')} className="h-10 rounded-md border border-input bg-background px-3"><option value="faang">Clean ATS format</option><option value="original">Preserve my section order</option></select></label>
              <label className="grid gap-1.5 text-sm"><span className="font-medium text-foreground">Length</span><select value={targetPages} onChange={(event) => setTargetPages(Number(event.target.value) as 1 | 2)} className="h-10 rounded-md border border-input bg-background px-3"><option value={1}>1 page (recommended)</option><option value={2}>2 pages</option></select></label>
            </div>
          </details>

          <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-4">
            <p className="min-w-0 truncate text-sm text-muted-foreground">{match.job_title}{match.company ? ` · ${match.company}` : ''}</p>
            <Button onClick={tailor} disabled={tailoring || analyzing}>
              {tailoring ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />Tailoring resume</> : <><Sparkles className="mr-2 h-4 w-4" />{draft ? 'Tailor again' : 'Tailor my resume'}</>}
            </Button>
          </div>
          {match.score_source === 'keyword_fallback' && <p className="text-xs text-muted-foreground">This estimate uses keyword coverage because the trained ATS scoring model is not available here.</p>}
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
            <div><p className="text-xs font-semibold uppercase text-muted-foreground">03 · Review</p><h2 className="mt-1 font-heading text-xl font-bold text-foreground">Your tailored resume</h2><p className="mt-1 text-sm text-muted-foreground">Review the document, make edits, then save a separate copy.</p></div>
            {draft.tailoring.ai.note && <p className="max-w-md text-xs text-warning">{draft.tailoring.ai.note}</p>}
          </div>

          {editsDirty && <p className="text-xs text-warning">You have edits the score and preview don’t reflect yet. Use “Update preview” to re-score them.</p>}

          <div role="tablist" aria-label="Tailored result" className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
            {([
              ['preview', 'Final resume'],
              ['edit', 'Review & edit'],
              ['changes', 'Changes'],
              ['analysis', 'Detailed analysis'],
              ['quality', 'Quality'],
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

          {tab === 'preview' && (
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.8fr)]">
              <section className="min-w-0" aria-label="Final resume preview">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted-foreground">Page 1 of {pages?.page_count ?? 1}{pages && !pages.fits ? ' · longer than the selected target' : ''}</p>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" aria-label="Zoom out" title="Zoom out" onClick={() => setPreviewZoom((value) => Math.max(60, (value === 'fit' ? 100 : value) - 10))} disabled={previewZoom !== 'fit' && previewZoom <= 60}><ZoomOut className="h-4 w-4" /></Button>
                    <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">{previewZoom === 'fit' ? 'Fit' : `${previewZoom}%`}</span>
                    <Button variant="outline" size="icon" aria-label="Zoom in" title="Zoom in" onClick={() => setPreviewZoom((value) => Math.min(130, (value === 'fit' ? 100 : value) + 10))} disabled={previewZoom !== 'fit' && previewZoom >= 130}><ZoomIn className="h-4 w-4" /></Button>
                    <Button variant="outline" size="icon" aria-label="Fit page" title="Fit page" onClick={() => setPreviewZoom('fit')}><Maximize2 className="h-4 w-4" /></Button>
                  </div>
                </div>
                {previewUrl && (!editsDirty || preview || !draft.resume.pdf_base64) ? (
                  <iframe title="Tailored resume preview" src={`${previewUrl}#toolbar=0&navpanes=0&zoom=${previewZoom === 'fit' ? 'page-fit' : previewZoom}`} className="h-[min(78vh,900px)] min-h-[520px] w-full rounded-md border border-border bg-white" />
                ) : (
                  <div className="grid min-h-[420px] place-items-center rounded-md border border-dashed border-border bg-muted/30 p-8 text-center">
                    <div className="grid justify-items-center gap-3">
                      <FileText className="h-8 w-8 text-muted-foreground" />
                      <div><p className="font-semibold text-foreground">{editsDirty ? 'Your edits need a refreshed preview' : 'Generate the resume preview'}</p><p className="mt-1 text-sm text-muted-foreground">This recompiles your current content without another AI tailoring run.</p></div>
                      <Button variant="outline" onClick={updatePreview} disabled={previewing || saving}>{previewing ? 'Updating preview…' : editsDirty ? 'Update preview' : 'Generate preview'}</Button>
                    </div>
                  </div>
                )}
              </section>

              <aside className="grid content-start gap-5 lg:sticky lg:top-20">
                <section className="grid gap-3 rounded-lg border border-border p-4">
                  <div><p className="text-xs font-semibold uppercase text-muted-foreground">Optimization complete</p><h3 className="mt-1 text-sm font-semibold text-foreground">Compatibility estimate</h3></div>
                  <ScoreComparison before={scoreBefore} after={scoreAfter} change={scoreChange} afterCaption={scoreCaption} source={scoreSource} />
                  <p className="text-xs text-muted-foreground">Internal estimate only. It is not an employer ATS result or screening guarantee.</p>
                </section>
                <section>
                  <h3 className="text-sm font-semibold text-foreground">Improvements</h3>
                  <ul className="mt-2 grid gap-2">
                    {draft.tailoring.changes.slice(0, 5).map((change, index) => <li key={`${change.change}-${index}`} className="flex gap-2 text-sm"><Check className="mt-0.5 h-4 w-4 shrink-0 text-success" /><span className="text-foreground">{change.change}</span></li>)}
                    <li className="flex gap-2 text-sm"><Check className="mt-0.5 h-4 w-4 shrink-0 text-success" /><span className="text-foreground">{draft.tailoring.bullet_changes.filter((change) => change.status === 'rewritten').length} experience bullets strengthened</span></li>
                    <li className="flex gap-2 text-sm"><Check className="mt-0.5 h-4 w-4 shrink-0 text-success" /><span className="text-foreground">{pages?.fits ? `Optimized to ${pages.target_pages} page${pages.target_pages === 1 ? '' : 's'}` : `${pages?.page_count ?? draft.resume.page_count} pages; selected target not met`}</span></li>
                  </ul>
                </section>
                {editsDirty && <Button variant="outline" onClick={updatePreview} disabled={previewing || saving}><RefreshCw className="mr-2 h-4 w-4" />Update preview and score</Button>}
                {savedCopy && !editsDirty ? (
                  <Button onClick={() => downloadSaved(savedCopy.id, savedCopy.resume_filename)}><Download className="mr-2 h-4 w-4" />Download PDF</Button>
                ) : (
                  <Button onClick={saveDraft} disabled={saving || previewing}><Save className="mr-2 h-4 w-4" />{saving ? 'Saving separate copy…' : 'Save tailored copy'}</Button>
                )}
                <p className="text-xs text-muted-foreground">Your original resume remains unchanged. Saving creates a separate PDF version.</p>
              </aside>
            </div>
          )}

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
                <Button variant="outline" onClick={updatePreview} disabled={(!editsDirty && Boolean(previewUrl)) || previewing || saving}>
                  {previewing ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />Updating preview</> : <><RefreshCw className="mr-2 h-4 w-4" />{editsDirty ? 'Update preview and score' : 'Generate preview'}</>}
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
