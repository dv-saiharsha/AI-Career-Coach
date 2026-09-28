import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Clock3, FileCheck, LoaderCircle, Sparkles, UploadCloud, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { resumeService } from '@/services/resumeService'
import { subscribeToScanStages } from '@/services/resumeProgressStream'
import { SCAN_STAGES, type ResumeOnFile, type ScanStage } from '@/types/resume'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const STAGE_LABELS: Record<ScanStage, string> = {
  extracting: 'Reading your resume file',
  checking: 'Verifying this is a real resume',
  analyzing: 'Comparing against the job description',
  reconciling: 'Reconciling skills your experience already implies',
  diagnostics: 'Building bullet-level feedback',
}

const SAMPLE_JOB_DESCRIPTION = `Senior Machine Learning Engineer — GenAI Platform

We're hiring a Senior ML Engineer to build production LLM systems end to end.

Requirements:
- 4+ years building and shipping production ML systems in Python
- Hands-on experience with PyTorch and modern NLP/GenAI architectures
- Experience building RAG pipelines with vector databases and embedding retrieval
- Cloud infrastructure experience (AWS: ECS, SageMaker, Lambda)
- Container orchestration with Docker and Kubernetes
- Strong track record of quantifying impact (latency, accuracy, cost) in past roles
- Bachelor's degree in Computer Science or equivalent practical experience

Nice to have:
- Experience with LangChain or similar orchestration frameworks
- Familiarity with distributed training and model serving at scale`

function AnalysisStep({ label, complete, active }: { label: string; complete?: boolean; active?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-[9px] text-[10px] text-muted-foreground',
        complete && 'text-success',
        active && 'font-bold text-primary'
      )}
    >
      <span
        className={cn(
          'grid h-[23px] w-[23px] shrink-0 place-items-center rounded-full bg-background',
          complete && 'bg-success-tint',
          active && 'bg-secondary'
        )}
      >
        {complete ? <Check size={13} /> : active ? <LoaderCircle size={13} className="animate-spin" /> : <Clock3 size={13} />}
      </span>
      {label}
    </div>
  )
}

export function ResumeUploadPage() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [jobDescription, setJobDescription] = useState('')
  const [isDragging, setIsDragging] = useState(false)

  const [onFile, setOnFile] = useState<ResumeOnFile | null>(null)
  const [onFileLoading, setOnFileLoading] = useState(true)
  const [useStoredResume, setUseStoredResume] = useState(false)

  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [currentStepIndex, setCurrentStepIndex] = useState(0)

  useEffect(() => {
    let cancelled = false
    resumeService
      .getResumeOnFile()
      .then((info) => {
        if (!cancelled) setOnFile(info)
      })
      .catch(() => {
        // The upload flow works fine without this — it's a convenience, not
        // a requirement, so a failed check here stays silent.
      })
      .finally(() => {
        if (!cancelled) setOnFileLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleFileSelect = (selectedFile: File) => {
    const validExtensions = ['.pdf', '.docx']
    const hasValidExt = validExtensions.some((ext) => selectedFile.name.toLowerCase().endsWith(ext))

    if (!hasValidExt) {
      toast.error('Invalid format. Please upload a PDF or DOCX file.')
      return
    }
    if (selectedFile.size > 10 * 1024 * 1024) {
      toast.error('File exceeds 10MB limit.')
      return
    }

    setFile(selectedFile)
    setUseStoredResume(false)
    toast.success(`${selectedFile.name} ready for analysis.`)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0])
    }
  }

  const handleAnalyze = async () => {
    if (!jobDescription.trim()) {
      toast.error('Please enter a target job description.')
      return
    }
    if (!useStoredResume && !file) {
      toast.error('Please upload your resume first.')
      return
    }

    setIsAnalyzing(true)
    setCurrentStepIndex(0)

    // Correlates this scan's progress events on the shared account stream —
    // see resumeProgressStream.ts. /rescan has no scan_id support on the
    // backend, so re-scans never get live events and rely on the fallback
    // ticker below for the whole duration.
    const scanId = crypto.randomUUID()
    let sawRealEvent = false
    const unsubscribe = useStoredResume
      ? () => {}
      : subscribeToScanStages(scanId, (stage) => {
          const idx = SCAN_STAGES.indexOf(stage as ScanStage)
          if (idx !== -1) {
            sawRealEvent = true
            setCurrentStepIndex(idx + 1)
          }
        })

    // Keeps the checklist moving if live progress never arrives, without
    // ever claiming the scan is done on its own — only a real response does
    // that below.
    const fallbackTimer = window.setInterval(() => {
      if (sawRealEvent) return
      setCurrentStepIndex((i) => (i < SCAN_STAGES.length - 1 ? i + 1 : i))
    }, 1500)

    try {
      if (useStoredResume) {
        await resumeService.rescanStoredResume(jobDescription)
      } else {
        await resumeService.analyzeResume(file as File, jobDescription, scanId)
      }
      setCurrentStepIndex(SCAN_STAGES.length)
      toast.success('ATS check complete.')
      navigate('/resume/results')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong.')
      setIsAnalyzing(false)
    } finally {
      window.clearInterval(fallbackTimer)
      unsubscribe()
    }
  }

  const loadSampleJD = () => {
    setJobDescription(SAMPLE_JOB_DESCRIPTION)
    toast.info('Sample job description loaded.')
  }

  if (isAnalyzing) {
    return (
      <div className="grid gap-[18px]">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div>
            <h2 className="font-heading text-2xl font-bold text-foreground">ATS check</h2>
          </div>
        </div>
        <Card className="relative flex min-h-[570px] flex-col items-center justify-center overflow-hidden p-8 text-center">
          <span className="mb-4 grid h-[58px] w-[58px] place-items-center rounded-2xl bg-secondary text-primary">
            <LoaderCircle size={27} className="animate-spin" />
          </span>
          <span className="inline-flex w-fit items-center gap-[5px] rounded-full bg-coral-tint px-[7px] py-1 text-[9px] font-extrabold uppercase tracking-[0.07em] text-coral-foreground">
            <Sparkles size={12} strokeWidth={2.4} /> AI analyzing
          </span>
          <h2 className="mt-[11px] font-heading text-2xl font-bold text-foreground">Reading your resume</h2>
          <p className="mb-5 mt-[7px] max-w-[480px] text-xs text-muted-foreground">
            We&rsquo;re mapping your experience against your target job description.
          </p>
          <div className="grid w-[min(100%-50px,430px)] gap-[9px] text-left">
            {SCAN_STAGES.map((stage, idx) => (
              <AnalysisStep
                key={stage}
                label={STAGE_LABELS[stage]}
                complete={idx < currentStepIndex}
                active={idx === currentStepIndex}
              />
            ))}
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="grid gap-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div>
          <h2 className="font-heading text-2xl font-bold text-foreground">ATS check</h2>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Upload your resume and a target job description to get an ATS score and gap analysis.
          </p>
        </div>
      </div>

      <Card className="relative flex min-h-[570px] flex-col items-center justify-center overflow-hidden p-8 text-center">
        <span className="mb-4 grid h-[58px] w-[58px] place-items-center rounded-2xl bg-secondary text-primary">
          <UploadCloud size={27} />
        </span>
        <span className="inline-flex w-fit items-center gap-[5px] rounded-full bg-coral-tint px-[7px] py-1 text-[9px] font-extrabold uppercase tracking-[0.07em] text-coral-foreground">
          <Sparkles size={12} strokeWidth={2.4} /> AI resume analysis
        </span>
        <h2 className="mt-[11px] font-heading text-2xl font-bold text-foreground">Upload your resume to get started</h2>
        <p className="mb-5 mt-[7px] max-w-[480px] text-xs text-muted-foreground">
          Get an ATS score, role-specific keyword gaps, and prioritized edits grounded in your target role.
        </p>

        <div className="grid w-full max-w-[520px] gap-4 text-left">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) handleFileSelect(e.target.files[0])
            }}
          />

          {useStoredResume && onFile?.has_resume ? (
            <div className="flex min-h-[70px] items-center justify-between gap-3 rounded-lg border border-border bg-secondary px-4 py-3">
              <div className="min-w-0 text-left">
                <p className="truncate text-sm font-semibold text-foreground">{onFile.filename}</p>
                <p className="text-xs text-muted-foreground">Using the resume already on file — no new upload needed.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setUseStoredResume(false)}>
                Upload different
              </Button>
            </div>
          ) : file ? (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex min-h-[70px] items-center justify-between gap-3 rounded-[12px] border border-solid border-success bg-success-tint px-4 py-3 text-left"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-success text-white">
                  <Check size={23} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{Math.round(file.size / 1024)} KB &middot; Ready to analyze</p>
                </div>
              </div>
              <span
                className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation()
                  setFile(null)
                }}
              >
                <X size={16} />
              </span>
            </button>
          ) : (
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'flex min-h-[180px] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-[12px] border-[1.5px] border-dashed border-[#cbd5e1] bg-background text-center transition-colors',
                isDragging && 'border-primary bg-secondary'
              )}
            >
              <span className="grid h-12 w-12 place-items-center rounded-full bg-secondary text-primary">
                <UploadCloud size={24} />
              </span>
              <strong className="text-sm text-foreground">Drop your resume here, or browse</strong>
              <small className="text-xs text-muted-foreground">PDF or DOCX &middot; Maximum 10 MB</small>
            </div>
          )}

          {!file && !onFileLoading && onFile?.has_resume && (
            <div className="text-xs text-muted-foreground">
              {onFile.can_rescan ? (
                <div className="flex items-center justify-between gap-3">
                  <span>
                    You have <strong className="text-foreground">{onFile.filename}</strong> on file
                    {typeof onFile.ats_score === 'number' && (
                      <>
                        {' '}
                        — last scored {onFile.ats_score}% ({onFile.band})
                      </>
                    )}
                    .
                  </span>
                  <button type="button" className="shrink-0 font-bold text-primary" onClick={() => setUseStoredResume(true)}>
                    Re-scan it instead
                  </button>
                </div>
              ) : (
                <span>Your last scan ({onFile.filename}) didn&rsquo;t keep the original file — upload it again to rescan.</span>
              )}
            </div>
          )}

          <div className="grid gap-2 text-left">
            <div className="flex items-center justify-between">
              <Label className="text-[13px] font-semibold text-foreground">Target job description</Label>
              <Button variant="ghost" size="sm" onClick={loadSampleJD} className="h-auto gap-1.5 p-0 text-xs text-primary">
                <Sparkles size={13} /> Load sample JD
              </Button>
            </div>
            <Textarea
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="Paste the job description here to tailor scores, keywords, and recommendations…"
              rows={7}
              className="text-xs"
            />
          </div>

          <Button
            onClick={handleAnalyze}
            disabled={!jobDescription.trim() || (!useStoredResume && !file)}
            className="w-full"
          >
            <UploadCloud size={16} /> Analyze resume
          </Button>
          <small className="text-center text-[8px] text-muted-foreground">Your data stays private</small>
        </div>
      </Card>
    </div>
  )
}
