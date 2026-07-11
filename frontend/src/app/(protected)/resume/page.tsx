'use client'

import { useRef, useState, type DragEvent, type FormEvent } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence, type Variants } from 'framer-motion'
import * as Tabs from '@radix-ui/react-tabs'
import {
  Upload, FileText, CheckCircle2, AlertCircle,
  Sparkles, Download, RotateCcw, ChevronRight, Info,
  GitCompare, Hash,
} from 'lucide-react'
import AnimatedNumber from '../../../components/AnimatedNumber'
import Loader from '../../../components/Loader'
import {
  analyzeResume,
  generateImprovedResume,
  type AnalysisResult,
} from '../../../lib/apiClient'
import { useAccentPalette } from '../../../lib/useAccentPalette'

type Status = 'idle' | 'loading' | 'success' | 'error'
type GenStatus = 'idle' | 'loading' | 'done' | 'error'
type ResultTab = 'diff' | 'suggestions' | 'keywords'

function scoreColor(score: number, palette: ReturnType<typeof useAccentPalette>) {
  if (score >= 80) return palette.accent
  if (score >= 60) return '#F59E0B'
  return '#EF4444'
}

function scoreLabel(score: number) {
  if (score >= 80) return 'Strong match'
  if (score >= 60) return 'Needs work'
  return 'Low match'
}

const containerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
}
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
}

export default function ResumeAnalyzer() {
  const palette = useAccentPalette()
  const [file, setFile] = useState<File | null>(null)
  const [jobDescription, setJobDescription] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set())
  const [fullName, setFullName] = useState('')
  const [genStatus, setGenStatus] = useState<GenStatus>('idle')
  const [genError, setGenError] = useState('')
  const [resultTab, setResultTab] = useState<ResultTab>('diff')

  const pickFile = (f: File | null) => {
    if (!f) return
    if (f.type !== 'application/pdf') {
      setError('That file is not a PDF. Export your resume as a PDF and upload it again.')
      setStatus('error')
      return
    }
    if (f.size > 10 * 1024 * 1024) {
      setError('That PDF is over 10 MB. Try a version without embedded images.')
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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!file) { setError('Add your resume before scanning.'); setStatus('error'); return }
    setStatus('loading'); setError(''); setUploadProgress(0)
    try {
      const fd = new FormData()
      fd.append('resume', file)
      fd.append('job_description', jobDescription)
      const data = await analyzeResume(fd, setUploadProgress)
      setResult(data)
      setStatus('success')
      setResultTab('diff')
      setSelectedSkills(new Set(data.missing_skills))
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
    setFullName(''); setGenStatus('idle'); setGenError(''); setResultTab('diff'); setUploadProgress(0)
  }

  const phase: 'uploading' | 'analyzing' | null =
    status !== 'loading' ? null : uploadProgress < 100 ? 'uploading' : 'analyzing'
  const stageIndex = status === 'success' ? 2 : phase === 'analyzing' ? 1 : file || phase === 'uploading' ? 0 : -1
  const maxKeywordFreq = result
    ? Math.max(1, ...result.keyword_analysis.map(k => k.frequency))
    : 1

  const totalKeywords = result ? result.matched_skills.length + result.missing_skills.length : 0
  const projectedScore = result && totalKeywords > 0
    ? Math.min(100, Math.round((100 * (result.matched_skills.length + selectedSkills.size)) / totalKeywords))
    : null
  const scoreDelta = result && projectedScore !== null ? Math.round(projectedScore - result.ats_score) : 0

  return (
    <div className="max-w-6xl relative">
      <div className="pointer-events-none absolute -top-24 right-0 w-[440px] h-[440px] bg-[var(--color-accent)]/5 rounded-full blur-[150px] -z-10" />

      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-8"
      >
        <span className="section-eyebrow-violet mb-3 inline-flex">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
          Resume Diagnostics
        </span>
        <h1 className="text-2xl md:text-3xl font-display font-semibold text-[var(--color-ink)] mt-3 mb-2">Know before you apply</h1>
        <p className="text-sm text-[var(--color-ink-dim)] leading-relaxed max-w-xl">
          Drop in your resume and the job description — we&apos;ll show you exactly what the ATS
          sees, what it flags, and what to fix, then hand you a resume that&apos;s already fixed.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-[440px_1fr] gap-6 items-start">
        <form onSubmit={handleSubmit} className="glass-card p-6 flex flex-col gap-5">
          <div>
            <label className="block text-xs font-mono tracking-wider uppercase text-[var(--color-ink-dim)] mb-2">
              Resume (PDF)
            </label>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click() }}
              className={`cursor-pointer rounded-xl border-2 border-dashed px-6 py-8 text-center transition-all ${
                dragOver
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5 scale-[1.01]'
                  : file
                  ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5'
                  : 'border-[var(--color-canvas-line)] bg-[var(--color-canvas)] hover:border-[var(--color-ink-faint)]'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={e => pickFile(e.target.files?.[0] ?? null)}
              />
              {file ? (
                <div className="flex items-center justify-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[var(--color-accent)]/15 flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-[var(--color-accent)]" />
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-medium text-[var(--color-ink)]">{file.name}</div>
                    <div className="text-xs text-[var(--color-ink-faint)]">
                      {(file.size / 1024).toFixed(0)} KB — click to replace
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <Upload className="w-6 h-6 text-[var(--color-ink-faint)] mx-auto mb-2" />
                  <div className="text-sm text-[var(--color-ink-dim)]">Drop your resume here</div>
                  <div className="text-xs text-[var(--color-ink-faint)] mt-1">or click to browse — PDF, up to 10 MB</div>
                </>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono tracking-wider uppercase text-[var(--color-ink-dim)] mb-2">
              Job Description
            </label>
            <textarea
              value={jobDescription}
              onChange={e => setJobDescription(e.target.value)}
              placeholder="Paste the job posting you are targeting..."
              rows={7}
              className="input-field resize-y"
            />
          </div>

          <AnimatePresence>
            {status === 'error' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-start gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5 overflow-hidden"
              >
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center justify-between gap-4 flex-wrap">
            <button
              type="submit"
              disabled={status === 'loading'}
              className="btn-violet w-fit disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              {status === 'loading' ? (
                <>
                  <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Scanning...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Scan Resume
                </>
              )}
            </button>
            <PipelineStages current={stageIndex} />
          </div>
        </form>

        <div>
          <AnimatePresence mode="wait">
            {(status === 'idle' || status === 'error') && (
              <motion.div
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="glass-card px-8 py-16 text-center"
              >
                <div className="w-14 h-14 rounded-2xl bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 flex items-center justify-center mx-auto mb-4">
                  <FileText className="w-6 h-6 text-[var(--color-accent)]/60" />
                </div>
                <p className="text-sm text-[var(--color-ink-faint)] max-w-xs mx-auto leading-relaxed">
                  Your ATS score, skill diff, and fix list will appear here once you scan a resume.
                </p>
              </motion.div>
            )}

            {phase === 'uploading' && (
              <motion.div
                key="uploading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="glass-card p-7"
              >
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse" />
                    <span className="text-xs font-mono uppercase tracking-widest text-[var(--color-accent-lighter)]">Uploading resume…</span>
                  </div>
                  <span className="text-2xl font-display font-bold text-[var(--color-ink)] tabular-nums">{uploadProgress}%</span>
                </div>
                <div className="h-2.5 rounded-full bg-[var(--color-canvas-line-soft)] overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-lighter)]"
                    initial={{ width: 0 }}
                    animate={{ width: `${uploadProgress}%` }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                  />
                </div>
                <p className="text-xs text-[var(--color-ink-faint)] mt-4">
                  Sending {file?.name} ({file ? (file.size / 1024).toFixed(0) : 0} KB) to the scan service…
                </p>
              </motion.div>
            )}

            {phase === 'analyzing' && (
              <motion.div
                key="analyzing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="glass-card p-7 relative overflow-hidden"
              >
                <motion.div
                  className="absolute left-0 right-0 h-28 bg-gradient-to-b from-transparent via-[var(--color-accent)]/[0.08] to-transparent pointer-events-none"
                  initial={{ top: '-30%' }}
                  animate={{ top: '130%' }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
                />
                <div className="relative z-10 flex flex-col items-center">
                  <div className="flex items-center gap-2 mb-2 self-start">
                    <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse" />
                    <span className="text-xs font-mono uppercase tracking-widest text-[var(--color-accent-lighter)]">Scanning resume…</span>
                  </div>
                  <div className="h-24 flex items-center justify-center -my-2">
                    <Loader />
                  </div>
                  <div className="flex flex-col gap-3.5 w-full mt-3">
                    {['Parsing PDF content', 'Matching against job description', 'Scoring keywords & skills'].map((step, i) => (
                      <div key={step} className="flex items-center gap-3 text-sm text-[var(--color-ink-dim)]">
                        <span
                          className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse shrink-0"
                          style={{ animationDelay: `${i * 200}ms` }}
                        />
                        {step}
                      </div>
                    ))}
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
                {/* Score card */}
                <motion.div variants={itemVariants} className="glass-card-violet p-6 md:p-7">
                  <div className="flex items-center justify-between mb-5">
                    <span className="text-[11px] font-mono uppercase tracking-widest text-[var(--color-ink-faint)]">ats_score.json</span>
                    <button
                      onClick={reset}
                      className="flex items-center gap-1.5 text-xs text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Scan another
                    </button>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center sm:items-start gap-7">
                    <div className="flex flex-col items-center gap-2 shrink-0">
                      <ScoreRing score={result.ats_score} />
                      <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--color-ink-faint)]">Original score</span>
                    </div>

                    <div className="flex-1 w-full">
                      <div
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full mb-4 border"
                        style={{
                          color: scoreColor(result.ats_score, palette),
                          backgroundColor: `${scoreColor(result.ats_score, palette)}1a`,
                          borderColor: `${scoreColor(result.ats_score, palette)}33`,
                        }}
                      >
                        {scoreLabel(result.ats_score)}
                      </div>
                      <div className="grid grid-cols-3 gap-3 mb-3">
                        {[
                          { label: 'Matched', value: result.matched_skills.length, color: palette.accent },
                          { label: 'Missing', value: result.missing_skills.length, color: '#EF4444' },
                          { label: 'Extracted', value: result.extracted_skills.length, color: palette.inkDim },
                        ].map(stat => (
                          <div key={stat.label} className="bg-[var(--color-canvas)] border border-[var(--color-canvas-line-soft)] rounded-xl px-3 py-2.5 text-center">
                            <div className="text-lg font-display font-bold tabular-nums" style={{ color: stat.color }}>
                              {stat.value}
                            </div>
                            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--color-ink-faint)] mt-0.5">
                              {stat.label}
                            </div>
                          </div>
                        ))}
                      </div>

                      <AnimatePresence mode="wait">
                        {selectedSkills.size > 0 && projectedScore !== null ? (
                          <motion.div
                            key="diff"
                            initial={{ opacity: 0, y: -6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{ duration: 0.25 }}
                            className="flex items-center gap-2.5 bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/25 rounded-xl px-3.5 py-2.5"
                          >
                            <span className="text-xs text-[var(--color-ink-dim)]">Projected after fixes:</span>
                            <span className="text-sm font-display font-bold text-[var(--color-ink)] tabular-nums">{projectedScore}%</span>
                            {scoreDelta !== 0 && (
                              <span className="text-xs font-semibold text-[var(--color-accent-lighter)] tabular-nums">
                                ({scoreDelta > 0 ? '+' : ''}{scoreDelta} pts)
                              </span>
                            )}
                            <span className="text-[10px] text-[var(--color-ink-faint)] ml-auto">
                              {selectedSkills.size} skill{selectedSkills.size !== 1 ? 's' : ''} staged
                            </span>
                          </motion.div>
                        ) : (
                          <motion.p
                            key="hint"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="text-xs text-[var(--color-ink-faint)]"
                          >
                            Stage a missing skill in the diff below to see your projected score.
                          </motion.p>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </motion.div>

                {/* Result tabs */}
                <motion.div variants={itemVariants}>
                  <Tabs.Root value={resultTab} onValueChange={v => setResultTab(v as ResultTab)}>
                    <Tabs.List className="flex items-center gap-1 mb-3 overflow-x-auto pb-1">
                      <Tabs.Trigger
                        value="diff"
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all border border-transparent text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)] hover:bg-white/5 data-[state=active]:border-[var(--color-canvas-line)] data-[state=active]:text-[var(--color-ink)] data-[state=active]:bg-[var(--color-canvas-raise)]"
                      >
                        <GitCompare className="w-3.5 h-3.5" />
                        Skill Diff
                      </Tabs.Trigger>
                      {result.suggestions.length > 0 && (
                        <Tabs.Trigger
                          value="suggestions"
                          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all border border-transparent text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)] hover:bg-white/5 data-[state=active]:border-[var(--color-canvas-line)] data-[state=active]:text-[var(--color-ink)] data-[state=active]:bg-[var(--color-canvas-raise)]"
                        >
                          <Info className="w-3.5 h-3.5" />
                          Suggestions
                        </Tabs.Trigger>
                      )}
                      {result.keyword_analysis.length > 0 && (
                        <Tabs.Trigger
                          value="keywords"
                          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all border border-transparent text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)] hover:bg-white/5 data-[state=active]:border-[var(--color-canvas-line)] data-[state=active]:text-[var(--color-ink)] data-[state=active]:bg-[var(--color-canvas-raise)]"
                        >
                          <Hash className="w-3.5 h-3.5" />
                          Keywords
                        </Tabs.Trigger>
                      )}
                    </Tabs.List>

                    <Tabs.Content value="diff" className="glass-card p-6">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-mono uppercase tracking-widest text-[var(--color-ink-faint)]">skills.diff</span>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-[var(--color-ink-faint)]" />
                          <span className="w-2 h-2 rounded-full bg-[var(--color-ink-faint)]" />
                          <span className="w-2 h-2 rounded-full bg-[var(--color-accent)]" />
                        </div>
                      </div>
                      <p className="text-xs text-[var(--color-ink-faint)] mb-4">
                        Matched skills are confirmed in your resume. Click a flagged skill to stage it for the improved resume.
                      </p>
                      <div className="font-mono text-xs md:text-sm leading-loose">
                        {result.matched_skills.map(skill => (
                          <div key={skill} className="flex items-center gap-2.5">
                            <span className="text-[var(--color-accent)] select-none w-3 text-center shrink-0">+</span>
                            <span className="lint-ok text-[var(--color-ink-subtle)]">{skill}</span>
                          </div>
                        ))}
                        {result.missing_skills.map(skill => {
                          const selected = selectedSkills.has(skill)
                          return (
                            <button
                              key={skill}
                              type="button"
                              onClick={() => toggleSkill(skill)}
                              className="flex items-center gap-2.5 w-full text-left group"
                            >
                              <span className={`select-none w-3 text-center shrink-0 ${selected ? 'text-[var(--color-accent)]' : 'text-red-400'}`}>
                                {selected ? '+' : '-'}
                              </span>
                              <span className={selected ? 'lint-ok text-[var(--color-ink-subtle)]' : 'lint-err text-[var(--color-ink-faint)] group-hover:text-[var(--color-ink-subtle)]'}>
                                {skill}
                              </span>
                              {selected && (
                                <span className="text-[10px] font-sans text-[var(--color-accent-light)] ml-1 shrink-0">staged for fix</span>
                              )}
                            </button>
                          )
                        })}
                        {result.matched_skills.length === 0 && result.missing_skills.length === 0 && (
                          <p className="text-[var(--color-ink-faint)] font-sans">No skill data returned for this scan.</p>
                        )}
                      </div>
                    </Tabs.Content>

                    {result.suggestions.length > 0 && (
                      <Tabs.Content value="suggestions" className="glass-card p-6">
                        <ul className="space-y-4">
                          {result.suggestions.map((s, i) => (
                            <li
                              key={i}
                              className="flex items-start gap-3 text-sm text-[var(--color-ink-subtle)] leading-relaxed border-l-2 border-[var(--color-canvas-line)] pl-3.5"
                            >
                              <ChevronRight className="w-3.5 h-3.5 text-[var(--color-accent-light)] mt-0.5 shrink-0" />
                              {s}
                            </li>
                          ))}
                        </ul>
                      </Tabs.Content>
                    )}

                    {result.keyword_analysis.length > 0 && (
                      <Tabs.Content value="keywords" className="glass-card p-6">
                        <div className="space-y-3">
                          {[...result.keyword_analysis]
                            .sort((a, b) => b.frequency - a.frequency)
                            .map(k => (
                              <div key={k.keyword} className="flex items-center gap-3">
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${k.present ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-ink-faint)]'}`} />
                                <span className="text-xs font-mono text-[var(--color-ink-subtle)] w-36 truncate shrink-0">{k.keyword}</span>
                                <div className="flex-1 h-1.5 bg-[var(--color-canvas-line-soft)] rounded-full overflow-hidden">
                                  <motion.div
                                    className="h-full rounded-full"
                                    style={{ backgroundColor: k.present ? palette.accent : palette.inkFaint }}
                                    initial={{ width: 0 }}
                                    animate={{ width: `${(k.frequency / maxKeywordFreq) * 100}%` }}
                                    transition={{ duration: 0.6, ease: 'easeOut' }}
                                  />
                                </div>
                                <span className="text-[10px] font-mono text-[var(--color-ink-faint)] w-5 text-right shrink-0">{k.frequency}</span>
                              </div>
                            ))}
                        </div>
                      </Tabs.Content>
                    )}
                  </Tabs.Root>
                </motion.div>

                {/* Generate improved resume */}
                <motion.div variants={itemVariants} className="glass-card-violet p-6">
                  <div className="flex items-center gap-2 mb-1">
                    <Sparkles className="w-4 h-4 text-[var(--color-accent)]" />
                    <span className="text-sm font-semibold text-[var(--color-ink)]">Update My Resume</span>
                  </div>
                  <p className="text-xs text-[var(--color-ink-faint)] mb-5 ml-6">
                    One click: we merge your {selectedSkills.size} staged skill
                    {selectedSkills.size !== 1 ? 's' : ''} into your original resume text
                    {projectedScore !== null && selectedSkills.size > 0 ? ` (→ ${projectedScore}% projected)` : ''} and hand you back a ready-to-send PDF.
                  </p>

                  <div className="flex flex-col sm:flex-row gap-3 items-start">
                    <input
                      value={fullName}
                      onChange={e => setFullName(e.target.value)}
                      placeholder="Your Full Name (e.g. John Doe)"
                      className="input-field flex-1"
                    />
                    <button
                      type="button"
                      onClick={handleGenerate}
                      disabled={genStatus === 'loading' || selectedSkills.size === 0}
                      className="btn-violet whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                    >
                      {genStatus === 'loading' ? (
                        <>
                          <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                          Updating...
                        </>
                      ) : (
                        <>
                          <Download className="w-4 h-4" />
                          Update &amp; Download Resume
                        </>
                      )}
                    </button>
                  </div>

                  <AnimatePresence>
                    {genStatus === 'done' && (
                      <motion.div
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mt-3 flex items-center gap-2 text-sm text-[var(--color-accent)]"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        Your updated resume has been downloaded!
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {genError && (
                    <div className="mt-3 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">
                      {genError}
                    </div>
                  )}

                  <div className="mt-4 flex items-center gap-2">
                    <Link
                      href="/interview"
                      className="text-xs text-[var(--color-ink-faint)] hover:text-[var(--color-accent)] transition-colors flex items-center gap-1"
                    >
                      Practice the interview next
                      <ChevronRight className="w-3 h-3" />
                    </Link>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

/* ─── Score Ring ──────────────────────────────────────────────── */

function ScoreRing({ score, size = 152 }: { score: number; size?: number }) {
  const palette = useAccentPalette()
  const stroke = 10
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const color = scoreColor(score, palette)

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={palette.inkFaint} strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - Math.min(100, Math.max(0, score)) / 100) }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-4xl font-display font-bold tabular-nums leading-none" style={{ color }}>
          <AnimatedNumber value={Math.round(score)} />
        </div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--color-ink-faint)] mt-1.5">/ 100</div>
      </div>
    </div>
  )
}

/* ─── Pipeline Stages ─────────────────────────────────────────── */

function PipelineStages({ current }: { current: number }) {
  const stages = ['Upload', 'Parse', 'Score']
  return (
    <div className="flex items-center gap-2">
      {stages.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <span className={`stage-dot ${i <= current ? 'stage-dot--active' : ''}`} />
          <span className={`text-[10px] font-mono uppercase tracking-widest ${i <= current ? 'text-[var(--color-accent-lighter)]' : 'text-[var(--color-ink-faint)]'}`}>
            {label}
          </span>
          {i < stages.length - 1 && <span className="w-4 h-px bg-[var(--color-canvas-line)]" />}
        </div>
      ))}
    </div>
  )
}
