'use client'

import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence, type Variants } from 'framer-motion'
import * as Tabs from '@radix-ui/react-tabs'
import {
  Upload, FileText, CheckCircle2, AlertCircle,
  Sparkles, RotateCcw, ChevronRight, Info,
  GitCompare, Hash, Check, X, ScanLine,
} from 'lucide-react'
import Waveform from '../../../components/Waveform'
import { ResumeBuilderPanel } from '@/components/resume/ResumeBuilderPanel'
import { ResumeQualityPanel } from '@/components/resume/ResumeQualityPanel'
import { consumeJobContext } from '@/lib/jobContext'
import {
  analyzeResume,
  generateImprovedResume,
  type AnalysisResult,
} from '../../../lib/apiClient'
import { usePrefersReducedMotion } from '../../../lib/usePrefersReducedMotion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

type Status = 'idle' | 'loading' | 'success' | 'error'
type GenStatus = 'idle' | 'loading' | 'done' | 'error'
type ResultTab = 'missing' | 'suggestions' | 'keywords'

const EASE = [0.22, 1, 0.36, 1] as const

const STAGES = [
  'Receiving your resume',
  'Extracting skills & keywords',
  'Cross-referencing the job description',
  'Calculating your match score',
]

// Short, specific status lines that cycle under the stage checklist so the
// screen never looks stalled during the several-second analysis call.
const FLAVOR_LINES = [
  'Parsing PDF structure…',
  'Reading section headers…',
  'Identifying technical skills…',
  'Comparing keyword density…',
  'Weighing section relevance…',
  'Scoring against ATS heuristics…',
  'Finalizing your report…',
]

const containerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
}
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } },
}

export default function ResumeAnalyzer() {
  const reduce = usePrefersReducedMotion()
  const [file, setFile] = useState<File | null>(null)
  const [jobDescription, setJobDescription] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [autoStage, setAutoStage] = useState(0)
  const [flavorIndex, setFlavorIndex] = useState(0)
  const [pasteNotice, setPasteNotice] = useState<string | null>(null)
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
  useEffect(() => {
    const context = consumeJobContext()
    if (!context?.description) return
    /* eslint-disable react-hooks/set-state-in-effect -- see comment above */
    setJobDescription(context.description)
    setJobContextNotice(`${context.title} at ${context.company}`)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [])

  // Staged progress narrative: there are no incremental backend progress
  // events for analysis, so this steps through the named stages on a timer
  // and holds at the final one until the response actually returns.
  useEffect(() => {
    if (status !== 'loading') return
    const id = setInterval(() => {
      setAutoStage((prev) => Math.min(STAGES.length - 1, prev + 1))
    }, 900)
    return () => clearInterval(id)
  }, [status])

  useEffect(() => {
    if (status !== 'loading') return
    const id = setInterval(() => {
      setFlavorIndex((prev) => Math.min(FLAVOR_LINES.length - 1, prev + 1))
    }, 1400)
    // Rewind on the way out rather than on the way in: resetting in the effect
    // body is a synchronous setState during render commit, which cascades.
    return () => {
      clearInterval(id)
      setFlavorIndex(0)
    }
  }, [status])

  const loadingStage = status !== 'loading' ? 0 : autoStage

  const ACCEPTED_TYPES = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  ]

  const pickFile = (f: File | null) => {
    if (!f) return
    const ext = f.name.toLowerCase().split('.').pop()
    if (!ACCEPTED_TYPES.includes(f.type) && ext !== 'pdf' && ext !== 'docx') {
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
    if (!file) { setError('Add your resume before scanning.'); setStatus('error'); return }
    setStatus('loading'); setError(''); setAutoStage(0)
    try {
      const fd = new FormData()
      fd.append('resume', file)
      fd.append('job_description', jobDescription)
      const data = await analyzeResume(fd)
      setResult(data)
      setStatus('success')
      setResultTab('missing')
      // Missing skills start unstaged — the user opts in per skill rather
      // than every gap being pre-selected for them.
      setSelectedSkills(new Set())
    } catch {
      setError('Could not reach the scan service. Check that the API is running and try again.')
      setStatus('error')
    }
  }

  const toggleSkill = (skill: string) =>
    setSelectedSkills(prev => {
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
    setFullName(''); setGenStatus('idle'); setGenError(''); setResultTab('missing'); setAutoStage(0)
  }

  const maxKeywordFreq = result
    ? Math.max(1, ...result.keyword_analysis.map(k => k.frequency))
    : 1

  const totalKeywords = result ? result.matched_skills.length + result.missing_skills.length : 0
  const projectedScore = result && totalKeywords > 0
    ? Math.min(100, Math.round((100 * (result.matched_skills.length + selectedSkills.size)) / totalKeywords))
    : null
  const scoreDelta = result && projectedScore !== null ? Math.round(projectedScore - result.ats_score) : 0

  return (
    <div className="max-w-6xl mx-auto">
      <AnimatePresence mode="wait">
        {status === 'loading' && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="min-h-[60vh] flex items-center justify-center"
          >
            <div className="card px-8 py-10 max-w-[440px] w-full">
              <div className="eyebrow mb-6 justify-center flex items-center gap-2">
                <ScanLine strokeWidth={1.5} className="w-3.5 h-3.5" />
                Scanning your document
              </div>

              {/* Document silhouette with a repeating scan beam sweeping down it */}
              <div
                className="relative mx-auto mb-7 w-[104px] h-[132px] rounded-[6px] overflow-hidden"
                style={{ background: 'var(--color-canvas)', border: '1px solid var(--color-canvas-line)' }}
                aria-hidden="true"
              >
                <div className="absolute inset-0 flex flex-col gap-[7px] p-3 pt-4">
                  {[0.85, 0.65, 0.95, 0.55, 0.75, 0.4, 0.9, 0.6].map((w, i) => (
                    <div
                      key={i}
                      className="h-[3px] rounded-full"
                      style={{ width: `${w * 100}%`, background: 'var(--color-canvas-line)' }}
                    />
                  ))}
                </div>
                {!reduce && (
                  <motion.div
                    className="absolute left-0 right-0 h-9"
                    style={{
                      background:
                        'linear-gradient(180deg, transparent, color-mix(in srgb, var(--color-accent) 35%, transparent) 50%, transparent)',
                    }}
                    initial={{ top: '-20%' }}
                    animate={{ top: '110%' }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
                  />
                )}
                <div
                  className="absolute inset-0"
                  style={{ boxShadow: 'inset 0 0 24px color-mix(in srgb, var(--color-accent) 12%, transparent)' }}
                />
              </div>

              <div className="flex flex-col gap-2.5">
                {STAGES.map((label, i) => {
                  const done = i < loadingStage
                  const current = i === loadingStage
                  return (
                    <div key={label} className="flex items-center gap-3">
                      <span className="relative flex items-center justify-center w-4 h-4 shrink-0">
                        {done ? (
                          <Check strokeWidth={2} className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                        ) : (
                          <span
                            className="block w-[7px] h-[7px] rounded-full"
                            style={{ background: current ? 'var(--color-accent)' : 'var(--color-canvas-line)' }}
                          />
                        )}
                        {current && !reduce && (
                          <motion.span
                            className="absolute w-[7px] h-[7px] rounded-full"
                            style={{ background: 'var(--color-accent)' }}
                            animate={{ scale: [1, 2.2], opacity: [0.6, 0] }}
                            transition={{ duration: 1.1, repeat: Infinity, ease: 'easeOut' }}
                          />
                        )}
                      </span>
                      <span
                        className="text-[13px] font-medium transition-colors"
                        style={{ color: done || current ? 'var(--color-ink)' : 'var(--color-ink-faint)' }}
                      >
                        {label}
                      </span>
                    </div>
                  )
                })}
              </div>

              <div className="mt-6 pt-5 border-t border-[var(--color-canvas-line)] h-5">
                <AnimatePresence mode="wait">
                  <motion.p
                    key={flavorIndex}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.25 }}
                    className="text-xs font-mono text-[var(--color-ink-faint)] text-center"
                  >
                    {FLAVOR_LINES[flavorIndex]}
                  </motion.p>
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}

        {status === 'success' && result && (
          <motion.div
            key="results"
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="space-y-5"
          >
            <motion.div variants={itemVariants} className="flex items-center justify-between">
              <div>
                <span className="eyebrow mb-2 inline-flex">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
                  ATS Match Score
                </span>
                <h1 className="text-2xl md:text-3xl font-display italic font-medium text-[var(--color-ink)] mt-2">Here&apos;s how you match up.</h1>
              </div>
              <Button variant="ghost" size="sm" onClick={reset}>
                <RotateCcw strokeWidth={1.5} />
                Run new scan
              </Button>
            </motion.div>

            <motion.div variants={itemVariants}>
              <Waveform
                score={result.ats_score}
                subtitle={`${result.matched_skills.length} skills matched · ${result.missing_skills.length} missing · ${result.extracted_skills.length} decoded from your resume.`}
              />
            </motion.div>

            <AnimatePresence mode="wait">
              {selectedSkills.size > 0 && projectedScore !== null && (
                <motion.div
                  key="projected"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25 }}
                  className="flex items-center gap-2.5 card px-4 py-3"
                >
                  <span className="text-xs text-[var(--color-ink-dim)]">Projected after fixes:</span>
                  <span className="text-sm font-display font-medium text-[var(--color-ink)] tabular-nums">{projectedScore}%</span>
                  {scoreDelta !== 0 && (
                    <span className="text-xs font-mono text-[var(--color-accent)] tabular-nums">
                      ({scoreDelta > 0 ? '+' : ''}{scoreDelta} pts)
                    </span>
                  )}
                  <span className="text-[10px] font-mono text-[var(--color-ink-faint)] ml-auto">
                    {selectedSkills.size} skill{selectedSkills.size !== 1 ? 's' : ''} staged
                  </span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Result tabs */}
            <motion.div variants={itemVariants}>
              <Tabs.Root value={resultTab} onValueChange={v => setResultTab(v as ResultTab)}>
                <Tabs.List className="flex items-center gap-5 mb-4 border-b border-[var(--color-canvas-line)]">
                  <Tabs.Trigger
                    value="missing"
                    className="flex items-center gap-2 pb-3 eyebrow text-[var(--color-ink-faint)] border-b-2 border-transparent data-[state=active]:text-[var(--color-ink)] data-[state=active]:border-[var(--color-accent)] transition-colors"
                  >
                    <GitCompare strokeWidth={1.5} className="w-3.5 h-3.5" />
                    Missing skills
                  </Tabs.Trigger>
                  {result.suggestions.length > 0 && (
                    <Tabs.Trigger
                      value="suggestions"
                      className="flex items-center gap-2 pb-3 eyebrow text-[var(--color-ink-faint)] border-b-2 border-transparent data-[state=active]:text-[var(--color-ink)] data-[state=active]:border-[var(--color-accent)] transition-colors"
                    >
                      <Info strokeWidth={1.5} className="w-3.5 h-3.5" />
                      Suggestions
                    </Tabs.Trigger>
                  )}
                  {result.keyword_analysis.length > 0 && (
                    <Tabs.Trigger
                      value="keywords"
                      className="flex items-center gap-2 pb-3 eyebrow text-[var(--color-ink-faint)] border-b-2 border-transparent data-[state=active]:text-[var(--color-ink)] data-[state=active]:border-[var(--color-accent)] transition-colors"
                    >
                      <Hash strokeWidth={1.5} className="w-3.5 h-3.5" />
                      Keyword analysis
                    </Tabs.Trigger>
                  )}
                </Tabs.List>

                <Tabs.Content value="missing" className="card p-6">
                  <p className="text-xs text-[var(--color-ink-dim)] mb-4">
                    Matched skills are confirmed in your resume. Click a flagged skill to stage it for the improved resume.
                  </p>
                  <div className="flex flex-col gap-2">
                    {result.matched_skills.map(skill => {
                      // Matched by implication rather than stated outright.
                      // Shown apart from a plain match because a recruiter's
                      // literal keyword search still won't find it.
                      const implied = result.diagnostics?.implied_skills?.includes(skill) ?? false
                      return (
                        <div
                          key={skill}
                          className="flex items-center gap-2.5 pl-3 pr-4 py-2.5 rounded-[10px] border-l-[3px]"
                          style={{
                            borderLeftColor: implied
                              ? 'var(--color-signal-mid)'
                              : 'var(--color-signal-high)',
                            background: 'var(--color-canvas)',
                          }}
                        >
                          <Check
                            strokeWidth={1.5}
                            className="w-3.5 h-3.5 shrink-0"
                            style={{
                              color: implied
                                ? 'var(--color-signal-mid)'
                                : 'var(--color-signal-high)',
                            }}
                          />
                          <span className="text-sm font-medium text-[var(--color-ink)]">{skill}</span>
                          {implied && (
                            <span className="ml-auto shrink-0 text-[10px] font-mono uppercase tracking-wide text-[var(--color-ink-faint)]">
                              implied — state it
                            </span>
                          )}
                        </div>
                      )
                    })}
                    {result.missing_skills.map(skill => {
                      const selected = selectedSkills.has(skill)
                      return (
                        <Button
                          key={skill}
                          type="button"
                          variant="ghost"
                          onClick={() => toggleSkill(skill)}
                          aria-pressed={selected}
                          className="h-auto w-full justify-start gap-2.5 rounded-[10px] border-l-[3px] py-2.5 pl-3 pr-4 text-left"
                          style={{
                            borderLeftColor: selected ? 'var(--success)' : 'var(--danger)',
                            background: 'var(--canvas)',
                          }}
                        >
                          {selected
                            ? <Check strokeWidth={1.5} className="w-3.5 h-3.5 shrink-0 text-[var(--color-signal-high)]" />
                            : <X strokeWidth={1.5} className="w-3.5 h-3.5 shrink-0 text-[var(--color-signal-low)]" />}
                          <span className="text-sm font-medium text-[var(--color-ink)]">{skill}</span>
                          {selected ? (
                            <span className="text-[10px] font-mono uppercase tracking-wide text-[var(--color-accent)] ml-auto shrink-0">staged for fix</span>
                          ) : (
                            <span className="text-[10px] font-mono uppercase tracking-wide text-[var(--color-ink-faint)] ml-auto shrink-0">tap to stage</span>
                          )}
                        </Button>
                      )
                    })}
                    {result.matched_skills.length === 0 && result.missing_skills.length === 0 && (
                      <p className="text-sm text-[var(--color-ink-faint)]">No skill data returned for this scan.</p>
                    )}
                  </div>
                </Tabs.Content>

                {result.suggestions.length > 0 && (
                  <Tabs.Content value="suggestions" className="card p-6">
                    <ol className="space-y-4">
                      {result.suggestions.map((s, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-3 text-sm text-[var(--color-ink-subtle)] leading-relaxed"
                        >
                          <span className="font-mono text-[11px] text-[var(--color-ink-faint)] shrink-0 pt-0.5">{String(i + 1).padStart(2, '0')}</span>
                          {s}
                        </li>
                      ))}
                    </ol>
                  </Tabs.Content>
                )}

                {result.keyword_analysis.length > 0 && (
                  <Tabs.Content value="keywords" className="card p-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div>
                        <div className="eyebrow text-[10px] mb-3">Present</div>
                        <div className="flex flex-wrap gap-2">
                          {[...result.keyword_analysis]
                            .filter(k => k.present)
                            .sort((a, b) => b.frequency - a.frequency)
                            .map(k => (
                              <span
                                key={k.keyword}
                                className="chip"
                                style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }}
                              >
                                {k.keyword}
                                <span className="text-[var(--color-ink-faint)]">({k.frequency})</span>
                              </span>
                            ))}
                          {result.keyword_analysis.filter(k => k.present).length === 0 && (
                            <p className="text-sm text-[var(--color-ink-faint)]">No matched keywords.</p>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="eyebrow text-[10px] mb-3">Missing</div>
                        <div className="flex flex-wrap gap-2">
                          {[...result.keyword_analysis]
                            .filter(k => !k.present)
                            .sort((a, b) => b.frequency - a.frequency)
                            .map(k => (
                              <span
                                key={k.keyword}
                                className="chip"
                                style={{ borderColor: 'var(--color-signal-low)', color: 'var(--color-signal-low)' }}
                              >
                                {k.keyword}
                                <span className="text-[var(--color-ink-faint)]">({k.frequency})</span>
                              </span>
                            ))}
                          {result.keyword_analysis.filter(k => !k.present).length === 0 && (
                            <p className="text-sm text-[var(--color-ink-faint)]">No missing keywords.</p>
                          )}
                        </div>
                      </div>
                    </div>
                    <p className="text-[10px] font-mono text-[var(--color-ink-faint)] mt-4">
                      Frequency counted across {maxKeywordFreq >= 1 ? 'the job description' : 'the job description (no matches found)'}.
                    </p>
                  </Tabs.Content>
                )}
              </Tabs.Root>
            </motion.div>

            {/* Why the resume reads the way it does — diagnostics, no score.
                Sits between the score and the fix actions so the reasoning is
                read before the user decides what to change. */}
            {/* ResumeQualityPanel renders the readiness card itself, from the
                stored-scan report — so it appears here for a fresh scan and on
                any historical report without a second call site to keep in
                sync. */}
            <motion.div variants={itemVariants}>
              <ResumeQualityPanel key={result.id} analysisId={result.id} />
            </motion.div>

            {/* Generate improved resume */}
            <motion.div variants={itemVariants} className="card p-6">
              <div className="eyebrow mb-1">Tailor my resume</div>
              <p className="text-sm text-[var(--color-ink-dim)] mb-5">
                {selectedSkills.size > 0 ? (
                  <>
                    You&apos;ve staged {selectedSkills.size} missing skill
                    {selectedSkills.size !== 1 ? 's' : ''} above
                    {projectedScore !== null ? ` (→ ${projectedScore}% projected)` : ''}. Click below and
                    we&apos;ll add them to your resume&apos;s existing skills section — same layout, same
                    formatting, no rebuild from scratch.
                  </>
                ) : (
                  <>Select the missing skills you actually have from the list above, then tailor your resume to include them.</>
                )}
              </p>

              <div className="flex flex-col sm:flex-row gap-3 items-start">
                <label htmlFor="fullName" className="sr-only">
                  Your full name
                </label>
                <Input
                  id="fullName"
                  autoComplete="name"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="Your full name (e.g. John Doe)"
                  className="flex-1"
                />
                <Button
                  type="button"
                  onClick={handleGenerate}
                  disabled={genStatus === 'loading' || selectedSkills.size === 0}
                  className="whitespace-nowrap"
                >
                  {genStatus === 'loading' ? (
                    <>
                      <span className="w-4 h-4 rounded-full border-2 border-[var(--color-on-accent)]/30 border-t-[var(--color-on-accent)] animate-spin" />
                      Tailoring…
                    </>
                  ) : (
                    <>
                      <Sparkles strokeWidth={1.5} className="w-4 h-4" />
                      Tailor my resume
                    </>
                  )}
                </Button>
              </div>

              <AnimatePresence>
                {genStatus === 'done' && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-3 flex items-center gap-2 text-sm text-[var(--color-accent)]"
                  >
                    <CheckCircle2 strokeWidth={1.5} className="w-4 h-4" />
                    Your tailored resume has been downloaded.
                  </motion.div>
                )}
              </AnimatePresence>
              {genError && (
                <div className="mt-3 flex items-start gap-2 text-sm text-[var(--color-error)] border-l-[3px] border-[var(--color-error)] pl-3 py-1">
                  <AlertCircle strokeWidth={1.5} className="w-4 h-4 mt-0.5 shrink-0" />
                  {genError}
                </div>
              )}

              <div className="mt-4">
                <Link
                  href="/interview"
                  className="text-xs text-[var(--color-ink-faint)] hover:text-[var(--color-accent)] transition-colors inline-flex items-center gap-1"
                >
                  Practice the interview next
                  <ChevronRight strokeWidth={1.5} className="w-3 h-3" />
                </Link>
              </div>
            </motion.div>

            <motion.div variants={itemVariants}>
              <ResumeBuilderPanel
                analysisId={result.id}
                jobDescription={jobDescription}
                defaultName={fullName}
                prefillSkills={[...result.matched_skills, ...Array.from(selectedSkills)]}
              />
            </motion.div>
          </motion.div>
        )}

        {(status === 'idle' || status === 'error') && (
          <motion.div
            key="input"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
          >
            <div className="mb-8">
              <span className="eyebrow mb-3 inline-flex">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
                Resume Analyzer
              </span>
              <h1 className="text-2xl md:text-3xl font-display italic font-medium text-[var(--color-ink)] mt-3 mb-2">See what the scanner sees.</h1>
              <p className="text-sm text-[var(--color-ink-dim)] leading-relaxed max-w-xl">
                Drop in your resume and the job description — we&apos;ll decode exactly what the ATS
                is scanning for, what&apos;s missing, and how to close the gap.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              <form onSubmit={handleSubmit} className="card p-6 flex flex-col gap-5">
                <div>
                  <label className="eyebrow mb-2 block">
                    Resume (PDF or DOCX)
                  </label>
                  <div
                    onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click() }}
                    className="cursor-pointer rounded-[16px] px-6 py-8 text-center transition-colors"
                    style={{
                      border: dragOver
                        ? '1px solid var(--color-accent)'
                        : `1px dashed var(--color-canvas-line)`,
                      background: dragOver ? 'var(--color-accent-tint)' : 'transparent',
                      boxShadow: dragOver ? 'var(--glow-signal)' : 'none',
                    }}
                  >
                    {/* Visually hidden — the styled dropzone above is the
                        real affordance; this is what it delegates to. */}
                    <Input
                      ref={fileInputRef}
                      type="file"
                      accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
                      className="hidden"
                      onChange={e => pickFile(e.target.files?.[0] ?? null)}
                    />
                    {file ? (
                      <div className="flex items-center justify-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-[var(--color-accent-tint)] flex items-center justify-center shrink-0">
                          <FileText strokeWidth={1.5} className="w-4 h-4 text-[var(--color-accent)]" />
                        </div>
                        <div className="text-left">
                          <div className="text-sm font-medium text-[var(--color-ink)] font-mono">{file.name}</div>
                          <div className="text-xs text-[var(--color-ink-faint)] font-mono">
                            {(file.size / 1024).toFixed(0)} KB
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={(e) => { e.stopPropagation(); setFile(null) }}
                          aria-label="Remove file"
                          className="ml-1"
                        >
                          <X strokeWidth={1.5} />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <Upload strokeWidth={1.5} className="w-6 h-6 text-[var(--color-ink-faint)] mx-auto mb-2" />
                        <div className="text-sm text-[var(--color-ink-dim)]">Drop your resume here</div>
                        <div className="text-xs text-[var(--color-ink-faint)] mt-1">or click to browse — PDF or Word (.docx), up to 10 MB</div>
                      </>
                    )}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="eyebrow">
                      Job Description
                    </label>
                    <AnimatePresence>
                      {pasteNotice && (
                        <motion.span
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="text-[10px] font-mono text-[var(--color-accent)]"
                        >
                          {pasteNotice}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                  {/* Tells the user why the field arrived pre-filled — an
                      auto-populated textarea with no explanation reads as a
                      bug. Dismissible because it stops being useful once read. */}
                  <AnimatePresence>
                    {jobContextNotice && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-[var(--color-accent)]/20 bg-[var(--color-accent)]/5 px-3 py-2"
                      >
                        <span className="text-xs text-[var(--color-ink-dim)]">
                          Filled from <span className="font-medium text-[var(--color-ink)]">{jobContextNotice}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setJobContextNotice(null)}
                          aria-label="Dismiss"
                          className="shrink-0 text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <Textarea
                    value={jobDescription}
                    onChange={e => setJobDescription(e.target.value)}
                    onPaste={handleJobDescriptionPaste}
                    placeholder="Paste the job posting you are targeting…"
                    rows={7}
                    style={{ minHeight: 320 }}
                  />
                  <div className="text-[10px] font-mono text-[var(--color-ink-faint)] text-right mt-1.5">
                    {jobDescription.length.toLocaleString()} characters
                  </div>
                </div>

                <AnimatePresence>
                  {status === 'error' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="flex items-start gap-2 text-sm text-[var(--color-error)] border-l-[3px] border-[var(--color-error)] pl-3 py-1.5 overflow-hidden"
                    >
                      <AlertCircle strokeWidth={1.5} className="w-4 h-4 mt-0.5 shrink-0" />
                      {error}
                    </motion.div>
                  )}
                </AnimatePresence>

                <Button type="submit" disabled={!file} className="w-fit">
                  Run the scan
                </Button>
              </form>

              <div className="card px-8 py-16 text-center">
                <div className="w-14 h-14 rounded-full bg-[var(--color-accent-tint)] flex items-center justify-center mx-auto mb-4">
                  <FileText strokeWidth={1.5} className="w-6 h-6 text-[var(--color-accent)]" />
                </div>
                <p className="text-sm text-[var(--color-ink-faint)] max-w-xs mx-auto leading-relaxed">
                  Run a scan to see your signal strength, the skill gaps, and exactly what to fix.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
