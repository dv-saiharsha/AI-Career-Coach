'use client'

import { useMemo, useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import {
  CheckCircle2, Sparkles, RotateCcw,
  GitCompare, Hash, Check, X, Wand2,
} from 'lucide-react'
import Waveform from '@/components/Waveform'
import { ResumeBuilderPanel } from '@/components/resume/ResumeBuilderPanel'
import { ResumeQualityPanel } from '@/components/resume/ResumeQualityPanel'
import { ResumeReviewPanel } from '@/components/resume/ResumeReviewPanel'
import type { AnalysisResult } from '@/lib/apiClient'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InlineError } from './InlineError'
import { OptimizePlanPanel } from './OptimizePlanPanel'
import { type GenStatus, type ResultTab } from './scanShared'

type BuildMode = 'quick' | 'studio'

/** Shared trigger styling for the build-mode tabs — mirrors Button's
 *  `default` (active) and `ghost` (inactive) variants so the segmented
 *  control reads identically to the two buttons it replaced. */
const BUILD_TAB_CLASS = [
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full',
  'h-9 px-4 text-sm font-medium cursor-pointer transition-colors',
  'outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
  'text-ink-dim hover:text-ink hover:bg-canvas-elevated',
  'data-[state=active]:bg-accent data-[state=active]:text-on-accent data-[state=active]:shadow-(--glow-signal)',
].join(' ')

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
  onGenerate: () => void
  onResultTabChange: (tab: ResultTab) => void
  onReset: () => void
}

/**
 * Everything shown after a scan succeeds.
 *
 * Score, tabs, and diagnostics stay in one shared view regardless of what the
 * user does next — they're groundwork for either path, not part of the
 * choice. The choice itself is which PDF-producing action to take: a quick
 * skill-append onto the original file, or the full manual builder that
 * compiles a new one from scratch. Those were previously stacked as if the
 * second were a continuation of the first; they're two different products,
 * so the mode switch below is the actual fix.
 *
 * The switch is Radix Tabs rather than two buttons for two reasons, both
 * load-bearing:
 *
 *   `forceMount` keeps ResumeBuilderPanel alive when the user flips to Quick
 *   tailor and back. That panel owns roughly a dozen fields of local form
 *   state and fires its own autofill request on mount, so conditionally
 *   rendering it turned a mis-click into silent data loss.
 *
 *   Two bare buttons communicated the active mode only through colour, which
 *   a screen reader cannot see. Tabs supply role/aria-selected and arrow-key
 *   navigation for free, and match how segmented filters are already built
 *   elsewhere in the app.
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
  onResultTabChange,
  onReset,
}: ScanResultsPanelProps) {
  const [buildMode, setBuildMode] = useState<BuildMode>('quick')

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

      {/* The choice: patch the existing file, or rebuild it in the Studio.
          Both panels stay mounted (forceMount) — see the component docstring. */}
      <div className="panel-enter">
        <Tabs.Root value={buildMode} onValueChange={(v) => setBuildMode(v as BuildMode)}>
          <Tabs.List
            aria-label="How to produce your updated resume"
            className="card p-1.5 flex gap-1.5 w-fit mb-5"
          >
            <Tabs.Trigger value="quick" className={BUILD_TAB_CLASS}>
              <Sparkles strokeWidth={1.5} className="w-3.5 h-3.5" aria-hidden="true" />
              Quick tailor
            </Tabs.Trigger>
            <Tabs.Trigger value="studio" className={BUILD_TAB_CLASS}>
              <Wand2 strokeWidth={1.5} className="w-3.5 h-3.5" aria-hidden="true" />
              Rebuild in the Studio
            </Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="quick" forceMount className="card p-6 data-[state=inactive]:hidden">
            <div className="eyebrow mb-1">Tailor my resume</div>
            <p className="text-sm text-(--color-ink-dim) mb-5">
              {selectedSkills.size > 0 ? (
                <>
                  You&apos;ve staged {selectedSkills.size} missing skill
                  {selectedSkills.size !== 1 ? 's' : ''} above. Click below and we&apos;ll add them to
                  your resume&apos;s existing skills section — same layout, same formatting, no rebuild
                  from scratch. The panel above shows what the real model does with it.
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
                onChange={(e) => onFullNameChange(e.target.value)}
                placeholder="Your full name (e.g. John Doe)"
                className="flex-1"
              />
              <Button
                type="button"
                onClick={onGenerate}
                disabled={genStatus === 'loading' || selectedSkills.size === 0}
                aria-busy={genStatus === 'loading'}
                className="whitespace-nowrap"
              >
                {genStatus === 'loading' ? (
                  <>
                    <span
                      className="w-4 h-4 rounded-full border-2 border-(--color-on-accent)/30 border-t-(--color-on-accent) animate-spin"
                      aria-hidden="true"
                    />
                    Tailoring…
                  </>
                ) : (
                  <>
                    <Sparkles strokeWidth={1.5} className="w-4 h-4" aria-hidden="true" />
                    Tailor my resume
                  </>
                )}
              </Button>
            </div>

              {genStatus === 'done' && (
                <div
                 
                 
                  role="status"
                  className="mt-3 flex items-center gap-2 text-sm text-(--color-accent) panel-enter"
                >
                  <CheckCircle2 strokeWidth={1.5} className="w-4 h-4" aria-hidden="true" />
                  Your tailored resume has been downloaded.
                </div>
              )}
            {genError && (
              <div className="mt-3">
                <InlineError message={genError} />
              </div>
            )}
          </Tabs.Content>

          <Tabs.Content value="studio" forceMount className="data-[state=inactive]:hidden">
            <ResumeBuilderPanel
              analysisId={result.id}
              jobDescription={jobDescription}
              defaultName={fullName}
              prefillSkills={[...result.matched_skills, ...Array.from(selectedSkills)]}
            />
          </Tabs.Content>
        </Tabs.Root>
      </div>
    </div>
  )
}
