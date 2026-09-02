'use client'

import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { ScanUploadForm } from '@/components/resume/ScanUploadForm'
import { ScanProgressPanel } from '@/components/resume/ScanProgressPanel'
import { ScanResultsPanel } from '@/components/resume/ScanResultsPanel'
import { consumeJobContext } from '@/lib/jobContext'
import {
  analyzeResume,
  getResumeOnFile,
  rescanResume,
  type ResumeOnFile,
  generateImprovedResume,
  type AnalysisResult,
} from '../../../lib/apiClient'
import type { ScanStatus, GenStatus, ResultTab } from '@/components/resume/scanShared'

const ACCEPTED_FILE_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
]

/**
 * Owns every piece of scan/tailor state; renders one of the three views
 * (upload, scanning, results) based on `status`. Split out of a single
 * 800+ line component — the state and handlers stayed here since every
 * child still needs to call back into them, only the markup moved.
 */
export default function ResumeAnalyzer() {
  const [file, setFile] = useState<File | null>(null)
  const [jobDescription, setJobDescription] = useState('')
  const [status, setStatus] = useState<ScanStatus>('idle')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [pasteNotice, setPasteNotice] = useState<string | null>(null)
  /* 0-100 while bytes are on the wire, then null. Distinct from `status`:
     the upload finishing is not the scan finishing — parsing and the model
     run after it — and a bar that sits at 100% for eight seconds reads as a
     hang. See the two-phase indicator below. */
  const [uploadPercent, setUploadPercent] = useState<number | null>(null)
  /* What the account already has. Null until asked, so the reuse option
     never flashes in and out during the first paint. */
  const [onFile, setOnFile] = useState<ResumeOnFile | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set())
  const [fullName, setFullName] = useState('')
  const [genStatus, setGenStatus] = useState<GenStatus>('idle')
  const [genError, setGenError] = useState('')
  const [resultTab, setResultTab] = useState<ResultTab>('missing')
  const [jobContextNotice, setJobContextNotice] = useState<string | null>(null)

  // Handoff from /jobs: "Match resume" stashes a listing and navigates here.
  // Consuming is one-shot (see lib/jobContext.ts) so a listing can't silently
  // overwrite the field on every later visit.
  //
  // Runs once on mount rather than reacting to jobDescription, which would
  // clobber whatever the user typed next.
  //
  // set-state-in-effect is suppressed rather than solved with a lazy useState
  // initializer: (protected)/layout.tsx redirects server-side, so this page is
  // server-rendered for signed-in users. A lazy initializer would read
  // localStorage on the client only, so the server would emit an empty
  // textarea and the client a filled one — a hydration mismatch. Reading
  // after mount is the correct shape for a client-only external store; the
  // single extra render is the price of not desyncing hydration.
  /* Ask once, on mount. If the account already has a resume the form offers
     to re-use it, which turns the common case — same CV, different posting —
     from an upload into a click. */
  useEffect(() => {
    let cancelled = false
    void getResumeOnFile()
      .then((data) => {
        if (!cancelled) setOnFile(data)
      })
      /* Silent: not knowing what is on file costs the shortcut, not the
         feature. The upload path is still right there. */
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const context = consumeJobContext()
    if (!context?.description) return
    /* eslint-disable react-hooks/set-state-in-effect -- see comment above */
    setJobDescription(context.description)
    setJobContextNotice(`${context.title} at ${context.company}`)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [])

  const pickFile = (f: File | null) => {
    if (!f) return
    const ext = f.name.toLowerCase().split('.').pop()
    if (!ACCEPTED_FILE_TYPES.includes(f.type) && ext !== 'pdf' && ext !== 'docx') {
      setError('Only PDF and Word (.docx) resumes are accepted. Please upload your resume in one of those formats.')
      setStatus('error')
      return
    }
    if (f.size > 10 * 1024 * 1024) {
      setError('That file is over 10 MB. Try a version without embedded images.')
      setStatus('error')
      return
    }
    setFile(f)
    if (status === 'error') { setStatus('idle'); setError('') }
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setDragOver(false)
    pickFile(e.dataTransfer.files?.[0] ?? null)
  }

  const handleJobDescriptionPaste = () => {
    window.setTimeout(() => {
      const length = jobDescription.length
      if (length > 0) {
        setPasteNotice(`Pasted ${length.toLocaleString()} characters`)
        window.setTimeout(() => setPasteNotice(null), 2500)
      }
    }, 0)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    /* Nothing to upload and something on file? Score what is already there.
       This is the common path once someone has scanned once, and it is the
       reason the file input is no longer required. */
    const reusing = !file && Boolean(onFile?.can_rescan)
    if (!file && !reusing) {
      setError('Add your resume before scanning.')
      setStatus('error')
      return
    }

    setStatus('loading'); setError('')
    setUploadPercent(reusing ? null : 0)
    try {
      const data = reusing
        ? await rescanResume(jobDescription)
        : await analyzeResume(
            (() => {
              const fd = new FormData()
              fd.append('resume', file as File)
              fd.append('job_description', jobDescription)
              return fd
            })(),
            setUploadPercent,
          )
      setUploadPercent(null)
      setResult(data)
      void getResumeOnFile().then(setOnFile).catch(() => {})
      setStatus('success')
      setResultTab('missing')
      // Missing skills start unstaged — the user opts in per skill rather
      // than every gap being pre-selected for them.
      setSelectedSkills(new Set())
    } catch {
      setUploadPercent(null)
      setError('Could not reach the scan service. Check that the API is running and try again.')
      setStatus('error')
    }
  }

  const toggleSkill = (skill: string) =>
    setSelectedSkills((prev) => {
      const next = new Set(prev)
      if (next.has(skill)) next.delete(skill)
      else next.add(skill)
      return next
    })

  const handleGenerate = async () => {
    if (!fullName.trim()) { setGenError('Enter your full name for the PDF filename.'); return }
    if (!result) return
    setGenStatus('loading'); setGenError('')
    try {
      await generateImprovedResume(result.id, fullName.trim(), Array.from(selectedSkills))
      setGenStatus('done')
    } catch {
      setGenError('Could not generate the improved resume. Check that the API is running.')
      setGenStatus('error')
    }
  }

  const reset = () => {
    setFile(null); setJobDescription(''); setResult(null)
    setError(''); setStatus('idle'); setSelectedSkills(new Set())
    setFullName(''); setGenStatus('idle'); setGenError(''); setResultTab('missing')
  }

  const totalKeywords = result ? result.matched_skills.length + result.missing_skills.length : 0
  const projectedScore = result && totalKeywords > 0
    ? Math.min(100, Math.round((100 * (result.matched_skills.length + selectedSkills.size)) / totalKeywords))
    : null
  const scoreDelta = result && projectedScore !== null ? Math.round(projectedScore - result.ats_score) : 0

  return (
    <div className="max-w-6xl mx-auto">
      {/* Keys belong on the direct children of AnimatePresence — that's what
          lets `mode="wait"` see one view exit before the next enters. They
          were briefly moved onto each child's own root element during the
          Studio split, where AnimatePresence can't see them at all (it reads
          child.key via Children.forEach, deliberately without React's
          auto-assigned positional fallback), which silently turned every
          transition into a hard cut. */}
        {status === 'loading' && <ScanProgressPanel key="loading" uploadPercent={uploadPercent} />}

        {status === 'success' && result && (
          <ScanResultsPanel
            key="results"
            result={result}
            jobDescription={jobDescription}
            selectedSkills={selectedSkills}
            fullName={fullName}
            genStatus={genStatus}
            genError={genError}
            resultTab={resultTab}
            projectedScore={projectedScore}
            scoreDelta={scoreDelta}
            onToggleSkill={toggleSkill}
            onFullNameChange={setFullName}
            onGenerate={handleGenerate}
            onResultTabChange={setResultTab}
            onReset={reset}
          />
        )}

        {(status === 'idle' || status === 'error') && (
          <ScanUploadForm
            key="input"
            file={file}
            jobDescription={jobDescription}
            hasError={status === 'error'}
            error={error}
            dragOver={dragOver}
            pasteNotice={pasteNotice}
            jobContextNotice={jobContextNotice}
            fileInputRef={fileInputRef}
            onFile={onFile}
            onDragOver={() => setDragOver(true)}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onPickFile={pickFile}
            onRemoveFile={() => setFile(null)}
            onJobDescriptionChange={setJobDescription}
            onJobDescriptionPaste={handleJobDescriptionPaste}
            onDismissJobContextNotice={() => setJobContextNotice(null)}
            onSubmit={handleSubmit}
          />
        )}
    </div>
  )
}
