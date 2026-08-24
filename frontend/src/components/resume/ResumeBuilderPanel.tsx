'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Plus, Trash2, Sparkles, Download, AlertCircle, ArrowRight, FileCheck2,
} from 'lucide-react'
import {
  compileResume, stageResumeFixes, downloadCompiledResumePdf,
  type BuilderExperienceEntry, type BuilderEducationEntry,
  type BulletSuggestion, type CompileResumeResult,
} from '@/lib/apiClient'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

interface ResumeBuilderPanelProps {
  analysisId: number
  jobDescription: string
  defaultName: string
  /** Prefills technical_skills: what the scan already confirmed as present,
   * plus whatever missing skills the user has staged as "I actually have this." */
  prefillSkills: string[]
}

type Stage = 'idle' | 'staging' | 'compiling'

function SkillChips({
  skills,
  onAdd,
  onRemove,
}: {
  skills: string[]
  onAdd: (skill: string) => void
  onRemove: (skill: string) => void
}) {
  const [draft, setDraft] = useState('')
  const commit = () => {
    const value = draft.trim()
    if (value) onAdd(value)
    setDraft('')
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        {skills.map((skill) => (
          <span key={skill} className="chip">
            {skill}
            <button
              type="button"
              onClick={() => onRemove(skill)}
              aria-label={`Remove ${skill}`}
              className="text-[var(--color-ink-faint)] hover:text-[var(--color-danger)] transition-colors"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            commit()
          }
        }}
        onBlur={commit}
        placeholder="Type a skill and press Enter"
        className="h-9 text-sm"
      />
    </div>
  )
}

export function ResumeBuilderPanel({
  analysisId, jobDescription, defaultName, prefillSkills,
}: ResumeBuilderPanelProps) {
  const [candidateName, setCandidateName] = useState(defaultName)
  const [location, setLocation] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [linkedin, setLinkedin] = useState('')
  const [summary, setSummary] = useState('')
  const [technicalSkills, setTechnicalSkills] = useState<string[]>(prefillSkills)
  const [toolsSkills, setToolsSkills] = useState<string[]>([])
  const [experiences, setExperiences] = useState<BuilderExperienceEntry[]>([
    { title: '', company: '', dates: '', bullets: [''] },
  ])
  const [education, setEducation] = useState<BuilderEducationEntry[]>([])

  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState('')
  const [missingKeywords, setMissingKeywords] = useState<string[]>([])
  const [suggestions, setSuggestions] = useState<BulletSuggestion[]>([])
  const [appliedSuggestions, setAppliedSuggestions] = useState<Set<number>>(new Set())
  const [compileResult, setCompileResult] = useState<CompileResumeResult | null>(null)

  const updateExperience = (index: number, patch: Partial<BuilderExperienceEntry>) =>
    setExperiences((prev) => prev.map((exp, i) => (i === index ? { ...exp, ...patch } : exp)))

  const updateBullet = (expIndex: number, bulletIndex: number, text: string) =>
    setExperiences((prev) =>
      prev.map((exp, i) =>
        i === expIndex ? { ...exp, bullets: exp.bullets.map((b, bi) => (bi === bulletIndex ? text : b)) } : exp,
      ),
    )

  const cleanExperiences = () =>
    experiences
      .filter((exp) => exp.title.trim() || exp.company.trim())
      .map((exp) => ({ ...exp, bullets: exp.bullets.filter((b) => b.trim()) }))

  const cleanEducation = () => education.filter((e) => e.degree.trim() || e.institution.trim())

  const handleStageFixes = async () => {
    setStage('staging')
    setError('')
    try {
      const result = await stageResumeFixes(analysisId, cleanExperiences())
      setMissingKeywords(result.missing_keywords)
      setSuggestions(result.bullet_suggestions)
      setAppliedSuggestions(new Set())
    } catch {
      setError('Could not fetch fix suggestions. Check that the API is running.')
    } finally {
      setStage('idle')
    }
  }

  const applySuggestion = (suggestion: BulletSuggestion, index: number) => {
    setExperiences((prev) =>
      prev.map((exp, i) =>
        i === suggestion.experience_index
          ? { ...exp, bullets: exp.bullets.map((b) => (b === suggestion.original ? suggestion.suggested : b)) }
          : exp,
      ),
    )
    setAppliedSuggestions((prev) => new Set(prev).add(index))
  }

  const handleCompile = async () => {
    if (!candidateName.trim()) {
      setError('Enter your full name before compiling.')
      return
    }
    setStage('compiling')
    setError('')
    try {
      const result = await compileResume({
        job_description: jobDescription,
        candidate_name: candidateName.trim(),
        location, email, phone, linkedin, summary,
        technical_skills: technicalSkills,
        tools_skills: toolsSkills,
        experiences: cleanExperiences(),
        education: cleanEducation(),
      })
      setCompileResult(result)
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 503) {
        setError('The PDF compiler is not available on this server right now.')
      } else {
        setError('Could not compile your resume. Check the fields above and try again.')
      }
    } finally {
      setStage('idle')
    }
  }

  return (
    <div className="card p-6 space-y-6">
      <div>
        <div className="eyebrow mb-1">Build an ATS-optimized PDF</div>
        <p className="text-sm text-[var(--color-ink-dim)]">
          Fill in your details, get keyword and bullet-rewrite suggestions, and compile a clean single-page
          resume — scored by the same trained model as your scan above.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input value={candidateName} onChange={(e) => setCandidateName(e.target.value)} placeholder="Full name" />
        <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location" />
        <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" />
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" />
        <Input
          value={linkedin}
          onChange={(e) => setLinkedin(e.target.value)}
          placeholder="LinkedIn URL"
          className="sm:col-span-2"
        />
      </div>

      <div>
        <label className="eyebrow mb-2 block">Summary</label>
        <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} placeholder="A brief professional summary…" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="eyebrow mb-2 block">Technical skills</label>
          <SkillChips
            skills={technicalSkills}
            onAdd={(s) => setTechnicalSkills((prev) => [...prev, s])}
            onRemove={(s) => setTechnicalSkills((prev) => prev.filter((x) => x !== s))}
          />
        </div>
        <div>
          <label className="eyebrow mb-2 block">Tools</label>
          <SkillChips
            skills={toolsSkills}
            onAdd={(s) => setToolsSkills((prev) => [...prev, s])}
            onRemove={(s) => setToolsSkills((prev) => prev.filter((x) => x !== s))}
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="eyebrow">Experience</label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExperiences((prev) => [...prev, { title: '', company: '', dates: '', bullets: [''] }])}
          >
            <Plus strokeWidth={1.5} className="w-3.5 h-3.5" />
            Add role
          </Button>
        </div>
        <div className="flex flex-col gap-4">
          {experiences.map((exp, i) => (
            <div key={i} className="rounded-xl border border-[var(--color-canvas-line)] p-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
                <Input value={exp.title} onChange={(e) => updateExperience(i, { title: e.target.value })} placeholder="Title" />
                <Input value={exp.company} onChange={(e) => updateExperience(i, { company: e.target.value })} placeholder="Company" />
                <div className="flex gap-2">
                  <Input value={exp.dates} onChange={(e) => updateExperience(i, { dates: e.target.value })} placeholder="Dates" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove role"
                    onClick={() => setExperiences((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 strokeWidth={1.5} className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {exp.bullets.map((bullet, bi) => (
                  <div key={bi} className="flex gap-2">
                    <Input
                      value={bullet}
                      onChange={(e) => updateBullet(i, bi, e.target.value)}
                      placeholder="Bullet point — what you did and the outcome"
                      className="text-sm"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove bullet"
                      onClick={() =>
                        updateExperience(i, { bullets: exp.bullets.filter((_, idx) => idx !== bi) })
                      }
                    >
                      <Trash2 strokeWidth={1.5} className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-fit"
                  onClick={() => updateExperience(i, { bullets: [...exp.bullets, ''] })}
                >
                  <Plus strokeWidth={1.5} className="w-3 h-3" />
                  Add bullet
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="eyebrow">Education</label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEducation((prev) => [...prev, { degree: '', institution: '', dates: '' }])}
          >
            <Plus strokeWidth={1.5} className="w-3.5 h-3.5" />
            Add education
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          {education.map((edu, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input
                value={edu.degree}
                onChange={(e) => setEducation((prev) => prev.map((x, idx) => (idx === i ? { ...x, degree: e.target.value } : x)))}
                placeholder="Degree"
              />
              <Input
                value={edu.institution}
                onChange={(e) => setEducation((prev) => prev.map((x, idx) => (idx === i ? { ...x, institution: e.target.value } : x)))}
                placeholder="Institution"
              />
              <div className="flex gap-2">
                <Input
                  value={edu.dates}
                  onChange={(e) => setEducation((prev) => prev.map((x, idx) => (idx === i ? { ...x, dates: e.target.value } : x)))}
                  placeholder="Dates"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove education"
                  onClick={() => setEducation((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  <Trash2 strokeWidth={1.5} className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="secondary" onClick={handleStageFixes} disabled={stage === 'staging'}>
          {stage === 'staging' ? (
            <span className="w-4 h-4 rounded-full border-2 border-[var(--color-ink)]/30 border-t-[var(--color-ink)] animate-spin" />
          ) : (
            <Sparkles strokeWidth={1.5} className="w-4 h-4" />
          )}
          Suggest fixes
        </Button>
        <Button type="button" onClick={handleCompile} disabled={stage === 'compiling'}>
          {stage === 'compiling' ? (
            <span className="w-4 h-4 rounded-full border-2 border-[var(--color-on-accent)]/30 border-t-[var(--color-on-accent)] animate-spin" />
          ) : (
            <FileCheck2 strokeWidth={1.5} className="w-4 h-4" />
          )}
          Compile & score
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-sm text-[var(--color-error)] border-l-[3px] border-[var(--color-error)] pl-3 py-1">
          <AlertCircle strokeWidth={1.5} className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <AnimatePresence>
        {(missingKeywords.length > 0 || suggestions.length > 0) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-xl border border-[var(--color-canvas-line)] p-4 space-y-4"
          >
            {missingKeywords.length > 0 && (
              <div>
                <div className="eyebrow text-[10px] mb-2">Keywords still missing</div>
                <div className="flex flex-wrap gap-2">
                  {missingKeywords.map((kw) => (
                    <span key={kw} className="chip" style={{ borderColor: 'var(--color-signal-low)', color: 'var(--color-signal-low)' }}>
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {suggestions.length > 0 && (
              <div>
                <div className="eyebrow text-[10px] mb-2">Bullet rewrite suggestions</div>
                <div className="flex flex-col gap-3">
                  {suggestions.map((s, i) => (
                    <div key={i} className="rounded-lg bg-[var(--color-canvas)] p-3 text-sm">
                      <p className="text-[var(--color-ink-faint)] line-through mb-1">{s.original}</p>
                      <p className="text-[var(--color-ink)] font-medium mb-1">{s.suggested}</p>
                      <p className="text-xs text-[var(--color-ink-dim)] mb-2">{s.reason}</p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={appliedSuggestions.has(i)}
                        onClick={() => applySuggestion(s, i)}
                      >
                        <ArrowRight strokeWidth={1.5} className="w-3.5 h-3.5" />
                        {appliedSuggestions.has(i) ? 'Applied' : 'Apply to bullet'}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {compileResult && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-[var(--color-canvas-line)] p-4 flex flex-col sm:flex-row sm:items-center gap-4"
          >
            <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <div className="text-[10px] font-mono uppercase text-[var(--color-ink-faint)]">ATS score</div>
                <div className="text-xl font-display font-medium text-[var(--color-ink)]">{compileResult.ats_score}</div>
              </div>
              <div>
                <div className="text-[10px] font-mono uppercase text-[var(--color-ink-faint)]">Semantic match</div>
                <div className="text-xl font-display font-medium text-[var(--color-ink)]">{compileResult.semantic_match}%</div>
              </div>
              <div>
                <div className="text-[10px] font-mono uppercase text-[var(--color-ink-faint)]">Keywords</div>
                <div className="text-xl font-display font-medium text-[var(--color-ink)]">
                  {compileResult.keyword_matched_count}/{compileResult.keyword_total_count}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-mono uppercase text-[var(--color-ink-faint)]">Pages</div>
                <div className="text-xl font-display font-medium text-[var(--color-ink)]">{compileResult.page_count}</div>
              </div>
            </div>
            <Button
              type="button"
              onClick={() => downloadCompiledResumePdf(compileResult.pdf_base64, candidateName)}
            >
              <Download strokeWidth={1.5} className="w-4 h-4" />
              Download PDF
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
