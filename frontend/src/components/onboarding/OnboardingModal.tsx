'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Briefcase, Check, FileText, Sparkles, Upload, X } from 'lucide-react'

/**
 * Target roles, grouped the way the job cache is.
 *
 * These mirror JOB_DOMAINS in backend/app/modules/job_market/services.py
 * one-for-one, and that is not cosmetic. Picking a role here seeds the user's
 * feed, and the backend only holds warm listings for the roles it sweeps —
 * anything else triggers a cold scrape and shows an empty grid on day one.
 *
 * Two consequences worth knowing before editing this list:
 *
 *   Labels must survive normalise_query(), which lowercases and strips
 *   punctuation. "AI / Machine Learning Engineer" normalises to
 *   "ai machine learning engineer", which matches no cached role — so the
 *   combined slash-labels are split into the two roles the cache actually
 *   holds.
 *
 *   Adding a role here without adding it to JOB_DOMAINS gives that user an
 *   empty feed. "Full Stack Engineer" and "Cloud Engineer" were offered here
 *   and swept nowhere, which is why they are gone.
 */
interface RoleDomain {
  domain: string
  roles: string[]
}

const ROLE_DOMAINS: RoleDomain[] = [
  {
    domain: 'Software & AI',
    roles: [
      'Software Engineer',
      'Frontend Engineer',
      'Backend Engineer',
      'AI Engineer',
      'ML Engineer',
      'DevOps Engineer',
      'Data Scientist',
      'Security Engineer',
      'Product Manager',
    ],
  },
  {
    domain: 'Electrical & Hardware',
    roles: ['Electrical Engineer', 'Power Systems Engineer', 'Hardware Engineer'],
  },
  {
    domain: 'Construction & Infrastructure',
    roles: ['Construction Manager', 'Structural Engineer', 'Site Engineer'],
  },
  {
    domain: 'Core Engineering',
    roles: ['Mechanical Engineer', 'Civil Engineer', 'Industrial Engineer'],
  },
]

export /** Named for what is actually happening, so a slow step is explicable
 *  rather than mysterious. The last one is where the time goes. */
const SETUP_STAGES = [
  'Saving your target roles',
  'Finding a matching job description',
  'Scoring your resume against it',
]

const MIN_ROLES = 3
export const MAX_ROLES = 5

const MAX_FILE_BYTES = 10 * 1024 * 1024
const ACCEPTED = ['.pdf', '.docx']

export interface OnboardingResult {
  /** Null when the user skipped upload — the reminder drawer picks it up later. */
  resumeFile: File | null
  selectedRoles: string[]
}

interface OnboardingModalProps {
  isOpen: boolean
  onComplete: (data: OnboardingResult) => Promise<void>
  /** Saves nothing and closes. The reminder drawer picks the user up later. */
  onSkip?: () => Promise<void>
  /** Surfaced from the parent when the submit request fails. */
  error?: string | null
}

export function OnboardingModal({ isOpen, onComplete, onSkip, error }: OnboardingModalProps) {
  const [step, setStep] = useState<1 | 2>(1)
  const [resumeFile, setResumeFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [selectedRoles, setSelectedRoles] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSkipping, setIsSkipping] = useState(false)
  // Which stage of setup is running. Named steps rather than a spinner: the
  // resume scan is an LLM call that can take 20s+, and an unlabelled spinner
  // that long is indistinguishable from a hang.
  const [stage, setStage] = useState(0)

  if (!isOpen) return null

  function pickFile(file: File | null) {
    setFileError(null)
    if (!file) {
      setResumeFile(null)
      return
    }
    // Validated here as well as by the accept attribute, which is only a
    // filter in the picker dialog and is trivially bypassed by drag-and-drop.
    const name = file.name.toLowerCase()
    if (!ACCEPTED.some((ext) => name.endsWith(ext))) {
      setFileError('Upload a PDF or DOCX file.')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setFileError('That file is over 10MB. Try a smaller export.')
      return
    }
    setResumeFile(file)
  }

  function toggleRole(role: string) {
    setSelectedRoles((current) => {
      if (current.includes(role)) return current.filter((r) => r !== role)
      if (current.length >= MAX_ROLES) return current
      return [...current, role]
    })
  }

  /**
   * Skipping is a server-side fact, not a browser one.
   *
   * The tempting shortcut is localStorage.setItem('onboarding_completed'),
   * which is wrong twice: the backend never learns, so the modal returns on
   * the user's next device and on any cleared cache, and the profile row
   * still says onboarding is pending. POST /user/onboarding/skip records it
   * where every client can read it.
   */
  async function handleSkip() {
    if (!onSkip || isSkipping || isSubmitting) return
    setIsSkipping(true)
    try {
      await onSkip()
    } finally {
      setIsSkipping(false)
    }
  }

  async function handleFinish() {
    // Guard as well as disable: the button is a convenience, and a stray
    // Enter keypress shouldn't be able to submit an invalid selection.
    // The resume is deliberately not part of this check — it's optional now,
    // and the dashboard's reminder drawer follows up when it's missing.
    if (selectedRoles.length < MIN_ROLES || isSubmitting) return
    setIsSubmitting(true)
    try {
      // Advanced on a timer because the mutation exposes no incremental
      // progress. The final stage holds until the promise settles, so this
      // never claims to be finished before it is.
      setStage(0)
      const ticker = window.setInterval(
        () => setStage((current) => Math.min(SETUP_STAGES.length - 1, current + 1)),
        2200,
      )
      try {
        await onComplete({ resumeFile, selectedRoles })
      } finally {
        window.clearInterval(ticker)
      }
    } finally {
      // Reset even on success: the parent closes the modal, and leaving this
      // true would strand the button mid-spinner if the close is delayed.
      setIsSubmitting(false)
    }
  }

  const remaining = MIN_ROLES - selectedRoles.length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-ink)]/40 p-4 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="w-full max-w-xl rounded-3xl border border-[var(--color-canvas-line)] bg-[var(--color-canvas-raise)] p-7 shadow-[var(--shadow-pop)]"
      >
        {/* Reachable from either step. Nothing in this modal is required to
            use the product — roles only re-rank the job feed — so a user who
            wants to look around first should never have to walk to step 2 to
            find the exit. */}
        {onSkip && (
          <div className="mb-4 flex justify-end">
            <button
              type="button"
              onClick={handleSkip}
              disabled={isSubmitting || isSkipping}
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-40"
            >
              {isSkipping ? 'Skipping…' : 'Skip for now'}
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Step indicator */}
        <div className="mb-7 flex items-center gap-3">
          <StepPill index={1} label="Resume" active={step === 1} done={step > 1} />
          <div className="h-px flex-1 bg-[var(--color-canvas-line)]" />
          <StepPill index={2} label={`Roles (${MIN_ROLES}-${MAX_ROLES})`} active={step === 2} done={false} />
        </div>

        {step === 1 && (
          <div className="space-y-5">
            <div>
              <h2
                id="onboarding-title"
                className="text-xl font-semibold tracking-tight text-[var(--color-ink)]"
              >
                Welcome to ApplyCenter
              </h2>
              <p className="mt-1.5 text-sm text-[var(--color-ink-dim)]">
                Add your resume and we&apos;ll score it against your target roles as the baseline for
                every match from here. You can skip this and add it whenever you&apos;re ready.
              </p>
            </div>

            <label
              className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 transition-colors ${
                resumeFile
                  ? 'border-[var(--color-ok)]/40 bg-[var(--color-ok)]/5'
                  : 'border-[var(--color-canvas-line)] bg-[var(--color-canvas-deep)] hover:border-[var(--color-line-strong)]'
              }`}
            >
              {resumeFile ? (
                <FileText className="mb-2 h-8 w-8 text-[var(--color-ok)]" strokeWidth={1.5} />
              ) : (
                <Upload className="mb-2 h-8 w-8 text-[var(--color-ink-faint)]" strokeWidth={1.5} />
              )}
              <span className="text-sm font-medium text-[var(--color-ink)]">
                {resumeFile ? resumeFile.name : 'Drop your resume, or click to browse'}
              </span>
              <span className="mt-1 text-xs text-[var(--color-ink-faint)]">
                PDF or DOCX, up to 10MB
              </span>
              <input
                type="file"
                accept=".pdf,.docx"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />
            </label>

            {fileError && (
              <p className="text-xs font-medium text-[var(--color-danger)]">{fileError}</p>
            )}

            <div className="flex gap-3">
              {onSkip && (
                <button
                  type="button"
                  onClick={handleSkip}
                  disabled={isSkipping}
                  className="btn-secondary flex-1 disabled:opacity-40"
                >
                  {isSkipping ? 'Skipping…' : 'Skip for now'}
                </button>
              )}
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={isSkipping}
                className="btn-primary flex flex-1 items-center justify-center gap-2 disabled:opacity-40"
              >
                Continue
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
            {!resumeFile && (
              <p className="text-center text-xs text-[var(--color-ink-faint)]">
                No resume handy? Continue without one — we&apos;ll remind you from your dashboard.
              </p>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-[var(--color-ink)]">
                Pick {MIN_ROLES} to {MAX_ROLES} target roles
              </h2>
              <p className="mt-1.5 text-sm text-[var(--color-ink-dim)]">
                These drive your job feed and interview drills. You can change them later in
                settings.
              </p>
            </div>

            {/* Grouped rather than one flat wrap: with four domains in the
                list, a civil engineer scanning eighteen unlabelled chips has
                no way to tell the product covers their field at all. */}
            <div className="max-h-60 space-y-4 overflow-y-auto rounded-2xl border border-[var(--color-canvas-line)] p-3">
              {ROLE_DOMAINS.map(({ domain, roles }) => (
                <div key={domain}>
                  <div className="eyebrow mb-2">{domain}</div>
                  <div className="flex flex-wrap gap-2">
                    {roles.map((role) => {
                      const isSelected = selectedRoles.includes(role)
                      const atLimit = !isSelected && selectedRoles.length >= MAX_ROLES
                      return (
                        <button
                          key={role}
                          type="button"
                          onClick={() => toggleRole(role)}
                          disabled={atLimit}
                          aria-pressed={isSelected}
                          className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                            isSelected
                              ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-on-accent)]'
                              : 'border-[var(--color-canvas-line)] bg-[var(--color-canvas-deep)] text-[var(--color-ink-subtle)] hover:border-[var(--color-line-strong)] disabled:opacity-35'
                          }`}
                        >
                          <Briefcase className="h-3.5 w-3.5" />
                          {role}
                          {isSelected && <Check className="h-3.5 w-3.5" />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--color-ink-faint)]">
                {selectedRoles.length} of {MAX_ROLES} selected
              </span>
              <span
                className={
                  remaining > 0
                    ? 'font-medium text-[var(--color-warn)]'
                    : 'font-medium text-[var(--color-ok)]'
                }
              >
                {remaining > 0 ? `Choose ${remaining} more` : 'Ready'}
              </span>
            </div>

            <AnimatePresence>
              {error && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="text-xs font-medium text-[var(--color-danger)]"
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>

            {/* Progress readout. Replaces the button row while running so the
                slow stage has a name attached to it. */}
            <AnimatePresence>
              {isSubmitting && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-3 overflow-hidden"
                >
                  <div className="flex flex-col gap-2 rounded-[10px] border border-[var(--color-canvas-line)] bg-[var(--color-canvas-deep)] p-3">
                    {SETUP_STAGES.map((label, index) => {
                      const done = index < stage
                      const current = index === stage
                      return (
                        <div key={label} className="flex items-center gap-2.5">
                          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                            {done ? (
                              <Check strokeWidth={2.5} className="h-3 w-3 text-[var(--color-signal-high)]" />
                            ) : (
                              <span
                                className="block h-1.5 w-1.5 rounded-full"
                                style={{
                                  background: current
                                    ? 'var(--color-accent)'
                                    : 'var(--color-canvas-line)',
                                }}
                              />
                            )}
                          </span>
                          <span
                            className="text-xs"
                            style={{
                              color:
                                done || current
                                  ? 'var(--color-ink)'
                                  : 'var(--color-ink-faint)',
                            }}
                          >
                            {label}
                          </span>
                        </div>
                      )
                    })}
                    <p className="mt-0.5 text-[10px] leading-relaxed text-[var(--color-ink-faint)]">
                      Scoring a resume takes a few seconds. This won&apos;t time out.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                disabled={isSubmitting || isSkipping}
                className="btn-secondary px-5 disabled:opacity-40"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleFinish}
                disabled={selectedRoles.length < MIN_ROLES || isSubmitting || isSkipping}
                className="btn-primary flex flex-1 items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSubmitting ? 'Setting up…' : 'Complete setup'}
                {!isSubmitting && <Sparkles className="h-4 w-4" />}
              </button>
            </div>

            {onSkip && (
              <button
                type="button"
                onClick={handleSkip}
                disabled={isSubmitting || isSkipping}
                className="mt-3 w-full text-center text-xs text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-40"
              >
                {isSkipping ? 'Skipping…' : 'Set these later in Settings'}
              </button>
            )}
          </div>
        )}
      </motion.div>
    </div>
  )
}

function StepPill({
  index,
  label,
  active,
  done,
}: {
  index: number
  label: string
  active: boolean
  done: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
          done
            ? 'bg-[var(--color-ok)] text-[var(--color-on-accent)]'
            : active
              ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)]'
              : 'bg-[var(--color-canvas-deep)] text-[var(--color-ink-faint)]'
        }`}
      >
        {done ? <Check className="h-3.5 w-3.5" /> : index}
      </span>
      <span
        className={`text-sm font-medium ${active || done ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-faint)]'}`}
      >
        {label}
      </span>
    </div>
  )
}
