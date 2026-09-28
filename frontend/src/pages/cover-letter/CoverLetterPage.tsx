import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Building2,
  Check,
  Copy,
  Download,
  FileText,
  Loader2,
  MapPin,
  Quote,
  RefreshCw,
  Save,
  Search,
  Sparkles,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { useAuth } from '@/context/AuthContext'
import { HttpError } from '@/lib/http'
import { coverLetterService } from '@/services/coverLetterService'
import { jobsService } from '@/services/jobsService'
import { COVER_LETTER_TONES, type CoverLetterResult, type CoverLetterTone, type JobOption, type ResumeScanOption } from '@/types/coverLetter'
import { cn } from '@/lib/utils'

const MAX_LISTED_JOBS = 40

function base64ToBlob(base64: string, mime: string): Blob {
  const byteChars = atob(base64)
  const byteNumbers = new Array(byteChars.length)
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i)
  return new Blob([new Uint8Array(byteNumbers)], { type: mime })
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function AiBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex w-fit items-center gap-[5px] rounded-full bg-coral-tint px-[7px] py-1 text-[9px] font-extrabold uppercase tracking-[0.07em] text-coral-foreground">
      <Sparkles size={12} strokeWidth={2.4} /> {label}
    </span>
  )
}

export function CoverLetterPage() {
  const { user } = useAuth()

  const [jobQuery, setJobQuery] = useState('')
  const [jobs, setJobs] = useState<JobOption[]>([])
  const [jobsLoading, setJobsLoading] = useState(true)
  const [jobsError, setJobsError] = useState<string | null>(null)
  const [selectedJob, setSelectedJob] = useState<JobOption | null>(null)

  const [resumeScans, setResumeScans] = useState<ResumeScanOption[]>([])
  const [resumeLoading, setResumeLoading] = useState(true)
  const [resumeError, setResumeError] = useState<string | null>(null)
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<number | null>(null)

  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [linkedin, setLinkedin] = useState('')
  const [tone, setTone] = useState<CoverLetterTone>('professional')

  const [isGenerating, setIsGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [result, setResult] = useState<CoverLetterResult | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (user?.fullName) setFullName(user.fullName)
  }, [user?.fullName])

  const loadJobs = useCallback(async (query: string) => {
    setJobsLoading(true)
    setJobsError(null)
    try {
      const rows = await coverLetterService.searchJobs(query)
      setJobs(rows)
    } catch (err) {
      setJobsError(err instanceof HttpError ? err.message : 'Could not load job postings.')
    } finally {
      setJobsLoading(false)
    }
  }, [])

  const loadResumeScans = useCallback(async () => {
    setResumeLoading(true)
    setResumeError(null)
    try {
      const rows = await coverLetterService.listResumeScans()
      setResumeScans(rows)
      if (rows.length === 1) setSelectedAnalysisId(rows[0].id)
    } catch (err) {
      setResumeError(err instanceof HttpError ? err.message : 'Could not load your resume history.')
    } finally {
      setResumeLoading(false)
    }
  }, [])

  useEffect(() => {
    loadJobs('')
    loadResumeScans()
  }, [loadJobs, loadResumeScans])

  const missingRequirement = useMemo(() => {
    if (!selectedJob) return 'Select a job posting to write for.'
    if (!selectedJob.description) return 'This posting has no saved description — pick another one.'
    if (selectedAnalysisId === null) return 'Select a resume scan to ground the letter in.'
    if (!fullName.trim()) return 'Enter your name so the letter can be signed.'
    return null
  }, [selectedJob, selectedAnalysisId, fullName])

  const canSubmit = !missingRequirement && !isGenerating

  const letterText = useMemo(() => {
    if (!result) return ''
    const lines: string[] = []
    const name = fullName.trim() || 'Candidate'
    lines.push(name)
    const contactBits = [phone.trim(), linkedin.trim()].filter(Boolean)
    if (contactBits.length) lines.push(contactBits.join('  |  '))
    lines.push('')
    lines.push(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }))
    lines.push('')
    lines.push(`Re: ${result.job_title} at ${result.company}`)
    lines.push('')
    lines.push('Dear Hiring Manager,')
    lines.push('')
    for (const p of result.paragraphs) {
      lines.push(p)
      lines.push('')
    }
    lines.push('Sincerely,')
    lines.push(name)
    return lines.join('\n')
  }, [result, fullName, phone, linkedin])

  const wordCount = useMemo(() => (result ? result.paragraphs.join(' ').split(/\s+/).filter(Boolean).length : 0), [result])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    loadJobs(jobQuery)
  }

  const handleGenerate = async () => {
    if (!selectedJob || selectedAnalysisId === null) return
    setIsGenerating(true)
    setGenerateError(null)
    setSaved(false)
    try {
      const generated = await coverLetterService.generate({
        job_id: Number(selectedJob.id),
        analysis_id: selectedAnalysisId,
        full_name: fullName.trim(),
        phone: phone.trim(),
        linkedin: linkedin.trim(),
        tone,
      })
      setResult(generated)
      toast.success('Your cover letter is ready.')
    } catch (err) {
      const status = err instanceof HttpError ? err.response.status : undefined
      let message: string
      if (status === 429) message = "You've hit the cover letter rate limit. Try again in a little while."
      else if (status === 503) message = 'Cover letter generation is temporarily unavailable. Please try again shortly.'
      else if (err instanceof HttpError) message = err.message
      else message = 'Something went wrong generating this letter. Please try again.'
      setGenerateError(message)
      toast.error(message)
    } finally {
      setIsGenerating(false)
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(letterText)
      toast.success('Cover letter copied to clipboard.')
    } catch {
      toast.error('Could not copy automatically. Select the text and copy manually.')
    }
  }

  const handleDownload = () => {
    if (!result) return
    if (result.pdf_base64) {
      downloadBlob(base64ToBlob(result.pdf_base64, 'application/pdf'), result.download_filename)
      return
    }
    const filename = result.download_filename.replace(/\.pdf$/i, '.txt')
    downloadBlob(new Blob([letterText], { type: 'text/plain;charset=utf-8' }), filename)
  }

  const handleSaveToApplication = async () => {
    if (!selectedJob || !result) return
    setSaving(true)
    try {
      await jobsService.trackApplication({
        job_title: selectedJob.title,
        company: selectedJob.company,
        location: selectedJob.location,
        salary_range: selectedJob.salaryRange,
        job_url: undefined,
        job_description: selectedJob.description ?? undefined,
        status: 'saved',
      })
      setSaved(true)
      toast.success('Added to your Application Pipeline.')
    } catch (err) {
      toast.error(err instanceof HttpError ? err.message : 'Could not save to your pipeline.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div>
          <h2 className="font-heading text-2xl font-bold text-foreground">Cover Letter Generator</h2>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Create a tailored letter grounded in your experience and the role.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant="outline" onClick={handleGenerate} disabled={!canSubmit || !result}>
            <RefreshCw size={15} /> Regenerate
          </Button>
          <Button variant="outline" onClick={handleCopy} disabled={!result}>
            <Copy size={15} /> Copy
          </Button>
          <Button variant="outline" onClick={handleDownload} disabled={!result}>
            <Download size={15} /> Download
          </Button>
          <Button onClick={handleSaveToApplication} disabled={!result || saving || saved}>
            {saved ? <Check size={15} /> : <Save size={15} />} {saved ? 'Saved' : 'Save to Application'}
          </Button>
        </div>
      </div>

      <div className="grid gap-[14px] lg:grid-cols-[340px_minmax(420px,1fr)_270px]">
        {/* Left: tailor inputs — widened from Figma's 260px since this form
            carries real required fields (job/resume pickers, contact
            details) Figma's mock never needed, and needs room to breathe. */}
        <Card className="grid gap-[17px] p-[21px] lg:sticky lg:top-[92px]">
          <div>
            <span className="font-heading text-[9px] font-extrabold text-primary">01</span>
            <h3 className="mt-1.5 font-heading text-[15px] font-bold text-foreground">Tailor your letter</h3>
            <p className="mt-0.5 text-[9px] text-muted-foreground">Choose what this version should emphasize.</p>
          </div>

          <div className="grid gap-2">
            <Label className="text-[13px] font-semibold text-foreground">Job match</Label>
            <form onSubmit={handleSearch} className="flex gap-1.5">
              <Input
                value={jobQuery}
                onChange={(e) => setJobQuery(e.target.value)}
                placeholder="Search by role"
                className="text-xs"
              />
              <Button type="submit" variant="outline" size="icon" disabled={jobsLoading} className="shrink-0">
                {jobsLoading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              </Button>
            </form>
            {jobsError ? (
              <p className="text-[11px] text-destructive">{jobsError}</p>
            ) : jobsLoading ? (
              <Skeleton className="h-32 w-full rounded-md" />
            ) : jobs.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                No postings found.{' '}
                <Link to="/jobs" className="font-bold text-primary">
                  Browse Job Portal
                </Link>
              </p>
            ) : (
              <div className="grid max-h-52 gap-1.5 overflow-y-auto pr-0.5">
                {jobs.slice(0, MAX_LISTED_JOBS).map((job) => {
                  const isSelected = selectedJob?.id === job.id
                  const disabled = !job.description
                  return (
                    <button
                      key={job.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => setSelectedJob(job)}
                      className={cn(
                        'rounded-md border p-2 text-left transition-colors',
                        disabled && 'cursor-not-allowed opacity-50',
                        isSelected ? 'border-primary bg-secondary' : 'border-border hover:border-primary/40'
                      )}
                    >
                      <p className="truncate text-[11px] font-semibold text-foreground">{job.title}</p>
                      <p className="mt-0.5 flex items-center gap-1 truncate text-[9px] text-muted-foreground">
                        <Building2 size={10} /> {job.company}
                        <MapPin size={10} className="ml-1" /> {job.location}
                      </p>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="grid gap-2">
            <Label className="text-[13px] font-semibold text-foreground">Resume scan</Label>
            {resumeError ? (
              <p className="text-[11px] text-destructive">{resumeError}</p>
            ) : resumeLoading ? (
              <Skeleton className="h-14 w-full rounded-md" />
            ) : resumeScans.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                <Link to="/resume/upload" className="font-bold text-primary">
                  Scan a resume
                </Link>{' '}
                first.
              </p>
            ) : (
              <select
                className="h-10 w-full rounded-md border border-input bg-card px-2.5 text-xs text-foreground"
                value={selectedAnalysisId ?? ''}
                onChange={(e) => setSelectedAnalysisId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="" disabled>
                  Select a scan
                </option>
                {resumeScans.map((scan) => (
                  <option key={scan.id} value={scan.id}>
                    {scan.resume_filename} &middot; {Math.round(scan.ats_score)}% &middot; {formatDate(scan.created_at)}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-2">
              <Label className="text-[13px] font-semibold text-foreground">Full name</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jordan Lee" />
            </div>
            <div className="grid gap-2">
              <Label className="text-[13px] font-semibold text-foreground">Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <div className="grid gap-2">
            <Label className="text-[13px] font-semibold text-foreground">LinkedIn</Label>
            <Input value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="Optional" />
          </div>

          <div className="grid gap-2">
            <span className="text-[13px] font-semibold text-foreground">Tone</span>
            <div className="grid grid-cols-3 gap-0 rounded-[9px] bg-background p-[3px]">
              {COVER_LETTER_TONES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setTone(t.value)}
                  title={t.hint}
                  className={cn(
                    'min-h-[33px] rounded-[7px] px-[5px] text-[9px] font-bold capitalize transition-colors',
                    tone === t.value ? 'bg-card text-primary shadow-soft' : 'text-muted-foreground'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {generateError && (
            <p className="flex items-center gap-1.5 text-[11px] text-destructive">
              <AlertTriangle size={13} /> {generateError}
            </p>
          )}
          <Button className="w-full" onClick={handleGenerate} disabled={!canSubmit}>
            {isGenerating ? (
              <>
                <Loader2 size={15} className="animate-spin" /> Writing…
              </>
            ) : (
              <>
                <Sparkles size={15} /> Generate tailored letter
              </>
            )}
          </Button>
          {!isGenerating && missingRequirement && <p className="text-[10px] text-muted-foreground">{missingRequirement}</p>}
        </Card>

        {/* Center: letter */}
        <Card className="min-w-0 overflow-hidden">
          <div className="flex h-[48px] items-center justify-between border-b border-border bg-background px-4 text-[8px] text-muted-foreground">
            {result ? (
              <>
                <div className="flex items-center gap-2">
                  <AiBadge label="AI generated" />
                  <span>Edited just now</span>
                </div>
                <span>{wordCount} words</span>
              </>
            ) : (
              <span className="font-bold text-foreground/80">Letter preview</span>
            )}
          </div>
          <div className="min-h-[720px] px-[58px] py-[46px]">
            {isGenerating ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 py-20 text-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                <p className="max-w-xs text-xs text-muted-foreground">
                  Grounding it in your resume and this posting. Usually takes 5-15 seconds.
                </p>
              </div>
            ) : result ? (
              <div
                contentEditable
                suppressContentEditableWarning
                className="text-[11px] leading-[1.78] text-foreground outline-none [&_p]:mb-[18px]"
              >
                <p className="!mb-1 text-xs font-semibold">{fullName.trim() || 'Candidate'}</p>
                {(phone.trim() || linkedin.trim()) && (
                  <p className="!mb-1 text-muted-foreground">{[phone.trim(), linkedin.trim()].filter(Boolean).join('  |  ')}</p>
                )}
                <p className="text-muted-foreground">
                  {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
                <p className="font-medium">
                  {result.job_title} &middot; {result.company}
                </p>
                <p>Dear Hiring Manager,</p>
                {result.paragraphs.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
                <p>
                  Warmly,
                  <br />
                  <strong>{fullName.trim() || 'Candidate'}</strong>
                </p>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 py-20 text-center">
                <FileText className="h-8 w-8 text-muted-foreground" />
                <p className="max-w-xs text-xs text-muted-foreground">
                  Pick a job posting and resume scan on the left, then generate your letter.
                </p>
              </div>
            )}
          </div>
        </Card>

        {/* Right: insights */}
        <div className="grid gap-3 lg:sticky lg:top-[92px] lg:self-start">
          <Card className="p-[17px]">
            <div className="flex items-start justify-between gap-3">
              <AiBadge label="AI insights" />
              <Sparkles className="text-coral" size={18} />
            </div>
            <h3 className="mt-[7px] font-heading text-[15px] font-bold text-foreground">Grounded in your resume</h3>
            {result ? (
              result.grounded_in.length > 0 ? (
                <div className="mt-2.5 grid gap-1.5">
                  {result.grounded_in.map((quote, i) => (
                    <div key={i} className="flex items-start gap-1.5 rounded-md bg-secondary px-2.5 py-2 text-[10px] text-muted-foreground">
                      <Quote size={11} className="mt-0.5 shrink-0 text-primary" />
                      <span className="italic">&ldquo;{quote}&rdquo;</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-muted-foreground">No specific quotes were cited for this scan.</p>
              )
            ) : (
              <p className="mt-2 text-[11px] text-muted-foreground">Generate a letter to see what it's grounded in.</p>
            )}
          </Card>

          {result && result.unsupported_claims.length > 0 && (
            <Card className="p-[17px]">
              <h3 className="flex items-center gap-1.5 font-heading text-[13px] font-bold text-warning">
                <AlertTriangle size={14} /> Double-check these figures
              </h3>
              <p className="mt-1 text-[10px] text-muted-foreground">
                These appear in the letter but weren&rsquo;t found verbatim in your resume text.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {result.unsupported_claims.map((claim) => (
                  <Badge key={claim} variant="warning" className="font-mono text-[10px]">
                    {claim}
                  </Badge>
                ))}
              </div>
            </Card>
          )}

          <Card className="flex gap-[9px] border-[#fed7cc] bg-coral-tint p-[11px]">
            <span className="shrink-0 text-coral">
              <Sparkles size={16} />
            </span>
            <p className="text-[8.5px] leading-relaxed text-foreground">
              <strong className="block text-[10px]">Make it yours</strong>
              <span className="mt-[3px] block">
                Add one sentence about something specific you admire about{' '}
                {selectedJob?.company || 'the company'}.
              </span>
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}
