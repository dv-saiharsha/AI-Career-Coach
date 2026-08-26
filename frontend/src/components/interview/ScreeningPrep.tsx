'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, ChevronDown, Lightbulb, Radar, Sparkles } from 'lucide-react'
import { CopyButton } from '@/components/ui/copy-button'
import { generateScreeningPrep, type ScreeningPrep as Prep } from '@/lib/apiClient'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

const EASE = [0.22, 1, 0.36, 1] as const

/**
 * Highlights the [bracketed placeholders] that the answer templates are built
 * around. This is the point of the feature, not decoration: the backend never
 * asserts an achievement on the candidate's behalf, so the parts they must
 * supply from their own history have to read as blanks rather than as prose
 * they could recite unchanged.
 */
function TemplateText({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\])/g)
  return (
    <p className="text-sm leading-relaxed text-[var(--color-ink)]">
      {parts.map((part, i) =>
        part.startsWith('[') && part.endsWith(']') ? (
          <span
            key={i}
            className="rounded-[4px] px-1 py-0.5 font-mono text-[12px]"
            style={{
              background: 'var(--color-accent-tint)',
              color: 'var(--color-accent)',
              borderBottom: '1px dashed var(--color-accent)',
            }}
          >
            {part.slice(1, -1)}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  )
}

export function ScreeningPrep({ initialRole = '' }: { initialRole?: string }) {
  const [jobTitle, setJobTitle] = useState(initialRole)
  const [company, setCompany] = useState('')
  const [jdText, setJdText] = useState('')
  const [prep, setPrep] = useState<Prep | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const handleGenerate = async () => {
    if (!jobTitle.trim()) {
      setError('Enter the role you are screening for.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const data = await generateScreeningPrep({
        job_title: jobTitle.trim(),
        company: company.trim(),
        jd_text: jdText.trim(),
      })
      setPrep(data)
      setOpenId(data.screening_questions[0]?.id ?? null)
    } catch {
      setError('Could not generate the prep. Check that the API is running and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="card space-y-4 p-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="prep-role" className="eyebrow mb-2 block">
              Target role
            </label>
            <Input
              id="prep-role"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="e.g. Backend Engineer"
            />
          </div>
          <div>
            <label htmlFor="prep-company" className="eyebrow mb-2 block">
              Company <span className="text-[var(--color-ink-faint)]">(optional)</span>
            </label>
            <Input
              id="prep-company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="e.g. Acme"
            />
          </div>
        </div>

        <div>
          <label htmlFor="prep-jd" className="eyebrow mb-2 block">
            Job description <span className="text-[var(--color-ink-faint)]">(optional, but sharpens every question)</span>
          </label>
          <Textarea
            id="prep-jd"
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            placeholder="Paste the posting — the questions are drawn from what it actually asks for…"
            rows={5}
          />
        </div>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden border-l-[3px] border-[var(--color-error)] py-1.5 pl-3 text-sm text-[var(--color-error)]"
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        <Button type="button" onClick={handleGenerate} disabled={loading} aria-busy={loading || undefined}>
          {loading ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-on-accent)]/30 border-t-[var(--color-on-accent)]" />
              Building your prep…
            </>
          ) : (
            <>
              <Radar strokeWidth={1.5} className="h-4 w-4" />
              Generate screening prep
            </>
          )}
        </Button>
      </div>

      {prep && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="space-y-5"
        >
          <div
            className="flex items-start gap-2.5 rounded-[10px] p-4"
            style={{ border: '1px solid var(--color-canvas-line)', background: 'var(--color-canvas)' }}
          >
            <Sparkles strokeWidth={1.5} className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent)]" />
            <p className="text-xs leading-relaxed text-[var(--color-ink-dim)]">
              These are answer <span className="font-medium text-[var(--color-ink)]">templates</span>, not scripts.
              The highlighted blanks are yours to fill from real experience — a screener will probe one level
              deeper on anything you claim, so nothing here invents a number or a project for you.
            </p>
          </div>

          <div className="space-y-3">
            {prep.screening_questions.map((q) => {
              const isOpen = openId === q.id
              return (
                <div key={q.id} className="card overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenId(isOpen ? null : q.id)}
                    aria-expanded={isOpen}
                    className="flex w-full items-start justify-between gap-3 p-5 text-left transition-colors hover:bg-[var(--color-canvas)]"
                  >
                    <div className="space-y-1.5">
                      <div className="eyebrow text-[10px]">{q.type}</div>
                      <p className="text-sm font-medium leading-relaxed text-[var(--color-ink)]">{q.question}</p>
                    </div>
                    <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.18 }} className="shrink-0">
                      <ChevronDown strokeWidth={1.5} className="h-4 w-4 text-[var(--color-ink-faint)]" />
                    </motion.span>
                  </button>

                  <div className="flex justify-end px-5 pb-2">
                    <CopyButton value={q.question} label="question" />
                  </div>

                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div
                          className="space-y-4 border-t border-[var(--color-canvas-line)] p-5"
                          style={{ background: 'var(--color-canvas)' }}
                        >
                          <div
                            className="rounded-[10px] p-4"
                            style={{ border: '1px solid var(--color-accent)', background: 'var(--color-accent-tint)' }}
                          >
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <span className="eyebrow text-[10px]">Answer template — fill in the blanks</span>
                              {/* Copies the raw template including the [bracketed]
                                  placeholders, so it can be pasted into notes and
                                  filled in there rather than retyped. */}
                              <CopyButton value={q.answer_template} label="answer template" />
                            </div>
                            <TemplateText text={q.answer_template} />
                          </div>

                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {q.key_signal && (
                              <div>
                                <span className="eyebrow mb-1.5 block text-[10px]">What they&apos;re evaluating</span>
                                <p className="text-xs leading-relaxed text-[var(--color-ink-dim)]">{q.key_signal}</p>
                              </div>
                            )}
                            {q.what_to_avoid && (
                              <div>
                                <span className="eyebrow mb-1.5 flex items-center gap-1.5 text-[10px]">
                                  <AlertTriangle strokeWidth={1.5} className="h-3 w-3 text-[var(--color-signal-mid)]" />
                                  What to avoid
                                </span>
                                <p className="text-xs leading-relaxed text-[var(--color-ink-dim)]">{q.what_to_avoid}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>

          <div className="card p-6">
            <span className="eyebrow mb-4 flex items-center gap-2">
              <Lightbulb strokeWidth={1.5} className="h-3.5 w-3.5 text-[var(--color-accent)]" />
              Principles &amp; pivot strategies
            </span>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {prep.general_interview_tips.map((tip) => (
                <div key={tip.title} className="space-y-1.5">
                  <h4 className="text-sm font-medium text-[var(--color-ink)]">{tip.title}</h4>
                  <p className="text-xs leading-relaxed text-[var(--color-ink-dim)]">{tip.rule}</p>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  )
}
