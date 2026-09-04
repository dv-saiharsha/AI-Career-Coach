'use client'

import { useMemo, useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import {
  CheckCircle2, Sparkles, RotateCcw,
  GitCompare, Hash, Check, X,
  FileText, Files, FileCode,
} from 'lucide-react'
import Waveform from '@/components/Waveform'
import { ResumeQualityPanel } from '@/components/resume/ResumeQualityPanel'
import { ResumeReviewPanel } from '@/components/resume/ResumeReviewPanel'
import type { AnalysisResult, QuickTailorResult } from '@/lib/apiClient'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InlineError } from './InlineError'
import { OptimizePlanPanel } from './OptimizePlanPanel'
import { type GenStatus, type ResultTab } from './scanShared'

const LENGTHS = [
  {
    pages: 1 as const,
    label: 'One page',
    icon: FileText,
    hint: 'The default, and what most screens expect. Your most job-relevant roles and bullets, trimmed to fit.',
  },
  {
    pages: 2 as const,
    label: 'Two pages — experienced',
    icon: Files,
    hint: 'Keeps more of a long history: earlier roles and more bullets per role. If your content only fills one page, you get one page — nothing is padded.',
  },
]

/** Shared trigger styling for the build-mode tabs — mirrors Button's
 *  `default` (active) and `ghost` (inactive) variants so the segmented
 *  control reads identically to the two buttons it replaced. */
/* The segmented control the two length options sit in. Selection is
   aria-pressed on a real Button now rather than Radix's data-[state], since
   these are two states of one control, not two tabs onto different panels. */
const BUILD_TAB_BASE = [
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full',
  'h-9 px-4 text-sm font-medium transition-colors',
].join(' ')

const BUILD_TAB_CLASS = `${BUILD_TAB_BASE} text-ink-dim hover:text-ink hover:bg-canvas-elevated`
const BUILD_TAB_CLASS_ACTIVE = `${BUILD_TAB_BASE} bg-accent text-on-accent shadow-(--glow-signal) hover:bg-accent`

interface ScanResultsPanelProps {
  result: AnalysisResult
  jobDescription: string
  selectedSkills: ReadonlySet<string>
  fullName: string
  genStatus: GenStatus
  genError: string
  resultTab: ResultTab
  onToggleSkill: (skill: string) => void
  onFullNameChange: (name: string) => void
  onGenerate: (targetPages: 1 | 2) => void
  genResult: QuickTailorResult | null
  onDownloadTex: () => void
  onResultTabChange: (tab: ResultTab) => void
  onReset: () => void
}

/**
 * Everything shown after a scan succeeds.
 *
 * Score, tabs, and diagnostics stay in one shared view regardless of what the
 * user does next — they're groundwork for either path, not part of the
 * choice.
 *
 * There is no longer a choice of builder. The Studio — a manual form that
 * asked the candidate to re-type the contact details, roles and bullets the
 * parser had just read out of the file they uploaded — is gone, and
 * everything it could produce is produced directly from the scan now. What
 * remains is one action with two lengths.
 *
 * The length control is two aria-pressed buttons rather than Radix Tabs.
 * Tabs were right when the two options were separate panels holding separate
 * form state; these are two states of one control, and a tablist that
 * switches nothing but a number reads wrong to a screen reader.
 */
export function ScanResultsPanel({
  result,
  jobDescription,
  selectedSkills,
  fullName,
  genStatus,
  genError,
  resultTab,
  onToggleSkill,
  onFullNameChange,
  onGenerate,
  genResult,
  onDownloadTex,
  onResultTabChange,
  onReset,
}: ScanResultsPanelProps) {
  const [targetPages, setTargetPages] = useState<1 | 2>(1)

  // One pass instead of four: the two columns below previously filtered the
  // same array once to render and again to test for emptiness.
  const { presentKeywords, missingKeywords } = useMemo(() => {
    const byFrequency = (a: { frequency: number }, b: { frequency: number }) => b.frequency - a.frequency
    return {
      presentKeywords: result.keyword_analysis.filter((k) => k.present).sort(byFrequency),
      missingKeywords: result.keyword_analysis.filter((k) => !k.present).sort(byFrequency),
    }
  }, [result.keyword_analysis])

  return (
    <div
     
     
     
      className="space-y-5 panel-enter"
    >
      <div className="flex items-center justify-between panel-enter">
        <div>
          <span className="eyebrow mb-2 inline-flex">
            <span className="w-1.5 h-1.5 rounded-full bg-(--color-accent)" />
            ATS Match Score
          </span>
          <h1 className="text-2xl md:text-3xl font-display italic font-medium text-(--color-ink) mt-2">Here&apos;s how you match up.</h1>
        </div>
        <Button variant="ghost" size="sm" onClick={onReset}>
          <RotateCcw strokeWidth={1.5} aria-hidden="true" />
          Run new scan
        </Button>
      </div>

      <div className="panel-enter">
        <Waveform
          score={result.ats_score}
          subtitle={`${result.matched_skills.length} skills matched · ${result.missing_skills.length} missing · ${result.extracted_skills.length} decoded from your resume.`}
        />
      </div>

        {/* What this resume can honestly reach, per the same model that
            produced ats_score above — not a client-side keyword ratio. */}
        {jobDescription.trim() && (
          <div key="optimize-plan" className="panel-enter">
            <OptimizePlanPanel analysisId={result.id} jobDescription={jobDescription} />
          </div>
        )}

      {/* Resume Review: named scores, why each is what it is, and what to do
          next. Reads the same stored scan through a second, free endpoint.
          ResumeQualityPanel below stays untouched — it covers weak-bullet
          and skill-context detail this doesn't reproduce. */}
      <div className="panel-enter">
        <ResumeReviewPanel key={result.id} analysisId={result.id} suggestions={result.suggestions} />
      </div>

      {/* Result tabs. General suggestions used to have a third trigger here —
          folded into Resume Review's Recommendations tab instead, since both
          were free-text improvement advice a tab apart from each other. */}
      <div className="panel-enter">
        <div className="eyebrow mb-1">Detailed breakdown</div>
        <p className="text-xs text-(--color-ink-dim) mb-4">
          The specific skills and keywords behind the scores above.
        </p>
        <Tabs.Root value={resultTab} onValueChange={(v) => onResultTabChange(v as ResultTab)}>
          <Tabs.List className="flex items-center gap-5 mb-4 border-b border-(--color-canvas-line)">
            <Tabs.Trigger
              value="missing"
              className="flex items-center gap-2 pb-3 eyebrow text-(--color-ink-faint) border-b-2 border-transparent data-[state=active]:text-(--color-ink) data-[state=active]:border-(--color-accent) transition-colors"
            >
              <GitCompare strokeWidth={1.5} className="w-3.5 h-3.5" aria-hidden="true" />
              Missing skills
            </Tabs.Trigger>
            {result.keyword_analysis.length > 0 && (
              <Tabs.Trigger
                value="keywords"
                className="flex items-center gap-2 pb-3 eyebrow text-(--color-ink-faint) border-b-2 border-transparent data-[state=active]:text-(--color-ink) data-[state=active]:border-(--color-accent) transition-colors"
              >
                <Hash strokeWidth={1.5} className="w-3.5 h-3.5" aria-hidden="true" />
                Keyword analysis
              </Tabs.Trigger>
            )}
          </Tabs.List>

          <Tabs.Content value="missing" className="card p-6">
            <p className="text-xs text-(--color-ink-dim) mb-4">
              Matched skills are confirmed in your resume. Click a flagged skill to stage it for the improved resume.
            </p>
            <div className="flex flex-col gap-2">
              {result.matched_skills.map((skill) => {
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
                      aria-hidden="true"
                      style={{
                        color: implied
                          ? 'var(--color-signal-mid)'
                          : 'var(--color-signal-high)',
                      }}
                    />
                    <span className="text-sm font-medium text-(--color-ink)">{skill}</span>
                    {implied && (
                      <span className="ml-auto shrink-0 text-[10px] font-mono uppercase tracking-wide text-(--color-ink-faint)">
                        implied — state it
                      </span>
                    )}
                  </div>
                )
              })}
              {result.missing_skills.map((skill) => {
                const selected = selectedSkills.has(skill)
                return (
                  <Button
                    key={skill}
                    type="button"
                    variant="ghost"
                    onClick={() => onToggleSkill(skill)}
                    aria-pressed={selected}
                    className="h-auto w-full justify-start gap-2.5 rounded-[10px] border-l-[3px] py-2.5 pl-3 pr-4 text-left"
                    style={{
                      borderLeftColor: selected ? 'var(--success)' : 'var(--danger)',
                      background: 'var(--canvas)',
                    }}
                  >
                    {selected
                      ? <Check strokeWidth={1.5} className="w-3.5 h-3.5 shrink-0 text-(--color-signal-high)" aria-hidden="true" />
                      : <X strokeWidth={1.5} className="w-3.5 h-3.5 shrink-0 text-(--color-signal-low)" aria-hidden="true" />}
                    <span className="text-sm font-medium text-(--color-ink)">{skill}</span>
                    {selected ? (
                      <span className="text-[10px] font-mono uppercase tracking-wide text-(--color-accent) ml-auto shrink-0">staged for fix</span>
                    ) : (
                      <span className="text-[10px] font-mono uppercase tracking-wide text-(--color-ink-faint) ml-auto shrink-0">tap to stage</span>
                    )}
                  </Button>
                )
              })}
              {result.matched_skills.length === 0 && result.missing_skills.length === 0 && (
                <p className="text-sm text-(--color-ink-faint)">No skill data returned for this scan.</p>
              )}
            </div>
          </Tabs.Content>

          {result.keyword_analysis.length > 0 && (
            <Tabs.Content value="keywords" className="card p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <div className="eyebrow text-[10px] mb-3">Present</div>
                  <div className="flex flex-wrap gap-2">
                    {presentKeywords.map((k) => (
                      <span
                        key={k.keyword}
                        className="chip"
                        style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }}
                      >
                        {k.keyword}
                        <span className="text-(--color-ink-faint)">({k.frequency})</span>
                      </span>
                    ))}
                    {presentKeywords.length === 0 && (
                      <p className="text-sm text-(--color-ink-faint)">No matched keywords.</p>
                    )}
                  </div>
                </div>
                <div>
                  <div className="eyebrow text-[10px] mb-3">Missing</div>
                  <div className="flex flex-wrap gap-2">
                    {missingKeywords.map((k) => (
                      <span
                        key={k.keyword}
                        className="chip"
                        style={{ borderColor: 'var(--color-signal-low)', color: 'var(--color-signal-low)' }}
                      >
                        {k.keyword}
                        <span className="text-(--color-ink-faint)">({k.frequency})</span>
                      </span>
                    ))}
                    {missingKeywords.length === 0 && (
                      <p className="text-sm text-(--color-ink-faint)">No missing keywords.</p>
                    )}
                  </div>
                </div>
              </div>
              <p className="text-[10px] font-mono text-(--color-ink-faint) mt-4">
                Frequency counted across the job description.
              </p>
            </Tabs.Content>
          )}
        </Tabs.Root>
      </div>

      {/* Why the resume reads the way it does — diagnostics, no score.
          Sits between the score and the fix actions so the reasoning is
          read before the user decides what to change. */}
      <div className="panel-enter">
        <ResumeQualityPanel key={result.id} analysisId={result.id} />
      </div>

      {/* One action, two lengths. The Studio tab that used to sit beside
          this is gone: it asked the candidate to re-enter, by hand, content
          the parser had already read out of the file they just uploaded, and
          almost nobody finished it. Everything it produced this now produces
          directly. */}
      <div className="panel-enter">
        <div className="card p-6">
          <div className="eyebrow mb-1">Build my resume</div>
          <p className="mb-5 text-sm text-(--color-ink-dim)">
            A FAANG-format resume built from the CV you uploaded, compiled to
            the length you pick. Every line is your own — the layout, the
            ordering and what fits are what change.
            {selectedSkills.size > 0 && (
              <> The {selectedSkills.size} skill{selectedSkills.size !== 1 ? 's' : ''} you staged above are included.</>
            )}
          </p>

          <fieldset className="mb-5">
            <legend className="mb-2 text-xs font-medium text-(--color-ink-dim)">Length</legend>
            <div className="card flex w-fit gap-1.5 p-1.5">
              {LENGTHS.map((option) => {
                const active = targetPages === option.pages
                return (
                  <Button
                    key={option.pages}
                    type="button"
                    variant="ghost"
                    aria-pressed={active}
                    onClick={() => setTargetPages(option.pages)}
                    className={active ? BUILD_TAB_CLASS_ACTIVE : BUILD_TAB_CLASS}
                  >
                    <option.icon strokeWidth={1.5} className="h-3.5 w-3.5" aria-hidden="true" />
                    {option.label}
                  </Button>
                )
              })}
            </div>
            <p className="mt-2 text-xs text-(--color-ink-faint)">
              {LENGTHS.find((l) => l.pages === targetPages)?.hint}
            </p>
          </fieldset>

          <div className="flex flex-col items-start gap-3 sm:flex-row">
            <label htmlFor="fullName" className="sr-only">
              Your full name
            </label>
            <Input
              id="fullName"
              autoComplete="name"
              value={fullName}
              onChange={(e) => onFullNameChange(e.target.value)}
              placeholder="Your full name (e.g. John Doe)"
              className="flex-1"
            />
            <Button
              type="button"
              onClick={() => onGenerate(targetPages)}
              loading={genStatus === 'loading'}
              loadingLabel="Building your resume"
              disabled={genStatus === 'loading'}
              className="whitespace-nowrap"
            >
              {genStatus !== 'loading' && (
                <Sparkles strokeWidth={1.5} className="h-4 w-4" aria-hidden="true" />
              )}
              {genStatus === 'loading' ? 'Building…' : 'Build my resume'}
            </Button>
          </div>

          {genResult && genStatus === 'done' && (
            <div role="status" className="panel-enter mt-4 space-y-2 text-sm">
              <div className="flex items-center gap-2 text-(--color-accent)">
                <CheckCircle2 strokeWidth={1.5} className="h-4 w-4" aria-hidden="true" />
                Downloaded {genResult.filename} — {genResult.page_count} page
                {genResult.page_count !== 1 ? 's' : ''}, scoring {genResult.ats_score}.
              </div>

              {/* Said plainly rather than hidden: a candidate whose oldest
                  role was cut to make the page needs to know before they
                  send it. */}
              {genResult.adjustments.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-(--color-ink-dim)">
                  {genResult.adjustments.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}

              {!genResult.fits && (
                <p className="text-xs text-(--color-signal-low)">
                  Your history would not compress to {genResult.target_pages} page
                  {genResult.target_pages !== 1 ? 's' : ''} without cutting a role you
                  should keep, so this is {genResult.page_count}.
                </p>
              )}

              <Button type="button" variant="ghost" size="sm" onClick={onDownloadTex}>
                <FileCode strokeWidth={1.5} className="h-3.5 w-3.5" aria-hidden="true" />
                Download the LaTeX source for Overleaf
              </Button>
            </div>
          )}

          {genError && (
            <div className="mt-3">
              <InlineError message={genError} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
