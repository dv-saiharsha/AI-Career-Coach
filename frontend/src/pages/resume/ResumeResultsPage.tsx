import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  FileSearch,
  ShieldAlert,
  Sparkles,
  UploadCloud,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Textarea } from '@/components/ui/textarea'
import { ConicRing } from '@/components/shared/ConicRing'
import { resumeService } from '@/services/resumeService'
import { reportService } from '@/services/reportService'
import type { AnalysisResult, ResumeHistoryItem, ResumeOnFile, ScoreBreakdown } from '@/types/resume'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

function rubricTone(score: number | null): 'success' | 'warning' | 'danger' {
  if (score == null) return 'warning'
  if (score < 50) return 'danger'
  if (score < 75) return 'warning'
  return 'success'
}

function RubricBar({ label, score }: { label: string; score: number | null }) {
  const tone = rubricTone(score)
  return (
    <div>
      <div className="mb-[5px] flex justify-between text-[9px] text-muted-foreground">
        <span>{label}</span>
        <strong className="text-foreground">{score ?? '—'}</strong>
      </div>
      <div className="h-[5px] overflow-hidden rounded-full bg-background">
        <span
          className={cn(
            'block h-full rounded-full bg-primary',
            tone === 'success' && 'bg-success',
            tone === 'warning' && 'bg-warning',
            tone === 'danger' && 'bg-destructive'
          )}
          style={{ width: `${score ?? 0}%` }}
        />
      </div>
    </div>
  )
}

function AiBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex w-fit items-center gap-[5px] rounded-full bg-coral-tint px-[7px] py-1 text-[9px] font-extrabold uppercase tracking-[0.07em] text-coral-foreground">
      <Sparkles size={12} strokeWidth={2.4} /> {label}
    </span>
  )
}

export function ResumeResultsPage() {
  const navigate = useNavigate()
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  // Whether `analysis` above actually holds the rich payload for the scan
  // being shown, vs. just what /on-file and /breakdown could still recover.
  // See resumeService.ts's cache docstring for why this distinction exists.
  const [hasFullDetail, setHasFullDetail] = useState(false)
  const [breakdown, setBreakdown] = useState<ScoreBreakdown | null>(null)
  const [onFile, setOnFile] = useState<ResumeOnFile | null>(null)
  const [versions, setVersions] = useState<ResumeHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [compareJd, setCompareJd] = useState('')
  const [comparing, setComparing] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(true)
  const [previewFailed, setPreviewFailed] = useState(false)

  const previewId = breakdown?.analysis_id ?? onFile?.analysis_id ?? null

  useEffect(() => {
    if (!previewId) {
      setPreviewLoading(false)
      return
    }
    let cancelled = false
    let objectUrl: string | null = null
    setPreviewLoading(true)
    setPreviewFailed(false)
    reportService
      .getOriginalFileBlob(previewId)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setPreviewUrl(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setPreviewFailed(true)
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false)
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setPreviewUrl(null)
    }
  }, [previewId])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const [info, history] = await Promise.all([resumeService.getResumeOnFile(), resumeService.getHistory()])
        if (cancelled) return
        setOnFile(info)
        setVersions(history)

        if (!info.has_resume || !info.analysis_id) return

        const cached = resumeService.getCachedAnalysis()
        if (cached && cached.id === info.analysis_id) {
          setAnalysis(cached)
          setHasFullDetail(true)
        }

        const bd = await resumeService.getBreakdown(info.analysis_id)
        if (!cancelled) setBreakdown(bd)
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : 'Could not load your resume analysis.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const analysisId = onFile?.analysis_id ?? analysis?.id ?? breakdown?.analysis_id

  const handleSelectVersion = async (idString: string) => {
    const id = Number(idString)
    if (!id || id === breakdown?.analysis_id) return
    try {
      const bd = await resumeService.getBreakdown(id)
      setBreakdown(bd)
      const cached = resumeService.getCachedAnalysis()
      if (cached && cached.id === id) {
        setAnalysis(cached)
        setHasFullDetail(true)
      } else {
        setHasFullDetail(false)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load that version.')
    }
  }

  const handleCompare = async () => {
    if (!compareJd.trim()) {
      toast.error('Paste a job description first.')
      return
    }
    setComparing(true)
    try {
      const result = await resumeService.rescanStoredResume(compareJd)
      setAnalysis(result)
      setHasFullDetail(true)
      const [info, history, bd] = await Promise.all([
        resumeService.getResumeOnFile(),
        resumeService.getHistory(),
        resumeService.getBreakdown(result.id),
      ])
      setOnFile(info)
      setVersions(history)
      setBreakdown(bd)
      setCompareOpen(false)
      setCompareJd('')
      toast.success('Re-scored against the new job description.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not compare against that job description.')
    } finally {
      setComparing(false)
    }
  }

  const handleDownloadReport = () => {
    if (!analysisId) return
    setDownloading(true)
    const promise = reportService.downloadReport(analysisId, analysis)
    toast.promise(promise, {
      loading: 'Preparing your report...',
      success: 'Report downloaded.',
      error: (err) => (err instanceof Error ? err.message : 'Failed to download report.'),
    })
    promise.finally(() => setDownloading(false))
  }

  const handleViewOriginal = () => {
    if (!analysisId) return
    toast.promise(reportService.viewOriginalFile(analysisId), {
      loading: 'Opening your original file...',
      success: 'Opened in a new tab.',
      error: (err) => (err instanceof Error ? err.message : 'Could not open the original file.'),
    })
  }

  const copySuggestion = (text: string) => {
    navigator.clipboard?.writeText(text)
    toast.success('Copied to clipboard.')
  }

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm font-medium text-muted-foreground">Loading analysis results...</p>
        </div>
      </div>
    )
  }

  if (!onFile?.has_resume || !onFile.analysis_id) {
    return (
      <Card className="mx-auto max-w-2xl space-y-4 p-10 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-primary">
          <FileSearch className="h-7 w-7" />
        </div>
        <h2 className="text-xl font-bold text-foreground">No resume scanned yet</h2>
        <p className="text-sm text-muted-foreground">
          Upload your resume and a target job description to get your first ATS match score.
        </p>
        <Button onClick={() => navigate('/resume/upload')} className="gap-2">
          <span>Analyze a resume</span>
          <ArrowRight className="h-4 w-4" />
        </Button>
      </Card>
    )
  }

  const filename = breakdown?.resume_filename ?? onFile.filename ?? 'your resume'
  const headlineScore = breakdown?.model_score ?? analysis?.ats_score ?? onFile.ats_score ?? 0
  const band = onFile.band ?? 'NOT CHECKED'
  const missingSkills = hasFullDetail && analysis ? analysis.missing_skills : breakdown?.missing_keywords ?? []
  const matchedSkills = hasFullDetail && analysis ? analysis.matched_skills : breakdown?.matched_keywords ?? []
  const previewExt = filename.split('.').pop()?.toLowerCase() ?? ''

  return (
    <div className="grid gap-[18px]">
      {/* Tool header */}
      <div className="relative flex flex-wrap items-center justify-between gap-5">
        <div>
          <h2 className="font-heading text-2xl font-bold text-foreground">ATS check</h2>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {filename}
            {onFile.scanned_at && <> &middot; Analyzed {new Date(onFile.scanned_at).toLocaleString()}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {versions.length > 0 && (
            <select
              className="h-11 w-[200px] rounded-md border border-input bg-card px-3 text-xs text-foreground"
              value={String(breakdown?.analysis_id ?? onFile.analysis_id ?? '')}
              onChange={(e) => handleSelectVersion(e.target.value)}
              aria-label="Version history"
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.resume_filename} &middot; {new Date(v.created_at).toLocaleDateString()}
                </option>
              ))}
            </select>
          )}
          <Button variant="outline" onClick={() => setCompareOpen(!compareOpen)}>
            <FileSearch size={16} /> Compare to job description <ChevronDown size={14} />
          </Button>
          <Button onClick={() => navigate('/resume/upload')}>
            <UploadCloud size={16} /> Upload new version
          </Button>
          <Button variant="ghost" size="icon" title="View original file" onClick={handleViewOriginal}>
            <ExternalLink size={16} />
          </Button>
          <Button variant="ghost" size="icon" title="Download report" onClick={handleDownloadReport} disabled={downloading}>
            <Download size={16} />
          </Button>
        </div>
        {compareOpen && (
          <Card className="absolute right-0 top-full z-10 mt-2 w-full max-w-md p-3 shadow-elevated">
            <Textarea
              value={compareJd}
              onChange={(e) => setCompareJd(e.target.value)}
              placeholder="Paste the job description here to tailor scores, keywords, and recommendations…"
              rows={6}
              className="text-xs"
            />
            <Button className="mt-2 w-full" onClick={handleCompare} disabled={comparing}>
              {comparing ? 'Analyzing…' : 'Analyze match'} <ArrowRight size={15} />
            </Button>
          </Card>
        )}
      </div>

      <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(500px,1.06fr)_minmax(410px,0.94fr)]">
        <Card className="flex min-w-0 flex-col overflow-hidden bg-[#edf1f6]">
          <div className="flex h-[46px] shrink-0 items-center justify-between border-b border-border bg-card px-[15px] text-[9px] text-muted-foreground">
            <span className="flex items-center gap-1.5 font-bold text-foreground/80">
              <FileSearch size={15} /> Resume preview
            </span>
            {previewExt && <span className="uppercase">{previewExt}</span>}
          </div>
          <div className="flex min-h-[600px] flex-1 items-center justify-center p-4">
            {previewLoading ? (
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            ) : previewUrl && previewExt === 'pdf' ? (
              <iframe title="Resume preview" src={previewUrl} className="h-full w-full rounded-md border-0" />
            ) : (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-secondary text-primary">
                  <FileSearch size={22} />
                </span>
                <p className="max-w-xs text-xs text-muted-foreground">
                  {previewFailed
                    ? "This scan didn't keep the original file, so no preview is available."
                    : previewUrl
                      ? `.${previewExt.toUpperCase()} files can't be previewed inline.`
                      : 'No preview available for this scan.'}
                </p>
                {previewUrl && (
                  <Button variant="outline" size="sm" onClick={handleViewOriginal}>
                    <ExternalLink size={14} /> Open original file
                  </Button>
                )}
              </div>
            )}
          </div>
        </Card>

        <div className="grid gap-4">
          <Card className="p-[19px]">
            <div className="flex items-center justify-between gap-5">
              <div>
                <AiBadge label="AI analysis" />
                <h2 className="mt-[7px] font-heading text-[18px] font-bold text-foreground">ATS resume score</h2>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {band === 'EXCELLENT' || band === 'STRONG'
                    ? 'Strong foundation — keep it sharp.'
                    : band === 'GOOD'
                      ? 'Solid start, with room to close a few gaps.'
                      : 'A few high-impact gaps are holding your score back.'}
                </p>
              </div>
              <ConicRing
                value={headlineScore}
                size={96}
                toneClassName={cn(
                  rubricTone(headlineScore) === 'success' && 'text-success',
                  rubricTone(headlineScore) === 'warning' && 'text-warning',
                  rubricTone(headlineScore) === 'danger' && 'text-destructive'
                )}
              >
                <span className="font-heading text-4xl font-extrabold text-foreground">{headlineScore}</span>
              </ConicRing>
            </div>
            {breakdown?.score_integrity?.stuffed && (
              <Alert variant="warning" className="mt-3">
                <ShieldAlert className="h-4 w-4" />
                <AlertTitle className="text-xs">Score integrity check flagged this scan</AlertTitle>
                <AlertDescription className="text-xs">
                  This document reads unusually close to the job posting&rsquo;s own wording, which can inflate the
                  model score above what real fit would earn.
                </AlertDescription>
              </Alert>
            )}
            {breakdown && (
              <div className="mt-[18px] grid gap-2.5 border-t border-border pt-4">
                {breakdown.metrics.map((m) => (
                  <RubricBar key={m.key} label={m.label} score={m.score} />
                ))}
              </div>
            )}
          </Card>

          <Card className="p-[19px]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-heading text-[15px] font-bold text-foreground">Keyword coverage</h3>
                <p className="mt-0.5 text-[10px] text-muted-foreground">Matched against your target job description.</p>
              </div>
              {missingSkills.length > 0 && (
                <Badge variant="warning" className="px-[7px] py-1 text-[8px] font-bold">
                  {missingSkills.length} gaps
                </Badge>
              )}
            </div>
            <span className="mb-2 mt-[15px] block text-[8px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
              Missing keywords
            </span>
            <div className="flex flex-wrap gap-1.5">
              {missingSkills.length === 0 && <p className="text-xs text-muted-foreground">None recorded for this scan.</p>}
              {missingSkills.map((keyword) => (
                <span
                  key={keyword}
                  className="inline-flex items-center gap-[3px] rounded-full border border-[#fde68a] bg-warning-tint px-2 py-[5px] text-[8px] font-bold text-warning"
                >
                  + {keyword}
                </span>
              ))}
            </div>
            <span className="mb-2 mt-[15px] block text-[8px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
              Already present
            </span>
            <div className="flex flex-wrap gap-1.5">
              {matchedSkills.length === 0 && <p className="text-xs text-muted-foreground">None recorded for this scan.</p>}
              {matchedSkills.map((keyword) => (
                <span
                  key={keyword}
                  className="inline-flex items-center gap-[3px] rounded-full border border-[#bbf7d0] bg-success-tint px-2 py-[5px] text-[8px] font-bold text-success"
                >
                  <Check size={11} /> {keyword}
                </span>
              ))}
            </div>
          </Card>

          <Card className="p-[19px]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <AiBadge label="AI prioritized" />
                <h3 className="mt-[7px] font-heading text-[15px] font-bold text-foreground">Recommended fixes</h3>
              </div>
              <Sparkles className="text-coral" size={20} />
            </div>
            <div className="mt-3 grid border-t border-border">
              {hasFullDetail && analysis ? (
                analysis.suggestions.length > 0 ? (
                  analysis.suggestions.map((s, index) => (
                    <div key={index} className="grid grid-cols-[25px_1fr_auto] items-start gap-[9px] border-t border-border py-[13px] first:border-t-0">
                      <span className="grid h-[22px] w-[22px] place-items-center rounded-[6px] bg-secondary font-heading text-[9px] font-extrabold text-primary">
                        {index + 1}
                      </span>
                      <p className="text-[11px] leading-relaxed text-foreground">{s}</p>
                      <Button variant="outline" size="sm" onClick={() => copySuggestion(s)}>
                        <Copy size={13} /> Copy
                      </Button>
                    </div>
                  ))
                ) : (
                  <p className="py-6 text-xs text-muted-foreground">No suggestions were recorded for this scan.</p>
                )
              ) : (
                <p className="py-6 text-xs text-muted-foreground">
                  Suggestions are only kept right after a scan.{' '}
                  <button className="font-bold text-primary" onClick={() => navigate('/resume/upload')}>
                    Re-scan
                  </button>{' '}
                  to see them.
                </p>
              )}
            </div>
          </Card>

          <Card className="relative overflow-hidden p-[23px]">
            <div className="grid h-9 w-9 place-items-center rounded-[13px] bg-secondary text-primary">
              <Sparkles size={18} />
            </div>
            <span className="mt-3 block text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
              Next step
            </span>
            <h3 className="mt-1 font-heading text-[17px] font-bold text-foreground">Practice your stronger stories</h3>
            <p className="mb-[17px] mt-1 text-[11px] text-muted-foreground">
              Turn the achievements in your resume into confident interview answers.
            </p>
            <Button variant="outline" onClick={() => navigate('/interview/setup')}>
              Continue <ArrowRight size={16} />
            </Button>
          </Card>
        </div>
      </div>
    </div>
  )
}
