'use client'

import * as React from 'react'
import { ScoreRing } from '@/components/ScoreRing'
import { Chip } from '@/components/ui/chip'
import { scoreAgainstSample, SAMPLE_RESUME, type SandboxResult } from '@/lib/sandboxScore'

const DEBOUNCE_MS = 150

const PLACEHOLDER = `Paste the job description here.

Anything works: the whole advert, or just the "what we're looking for" part.`

/**
 * The ATS sandbox.
 *
 * A real computation, not a scripted demo. It scores a fixed sample CV
 * against whatever the visitor pastes, entirely in this browser: no account,
 * no upload, no request. Someone who has been asked to trust a service with
 * their CV should be able to watch it work first.
 *
 * The recompute is debounced at 150ms and takes a fraction of a millisecond
 * on a job description, so the textarea never stutters. There is no submit
 * button because there is nothing to submit to.
 */
export function Sandbox() {
  const [text, setText] = React.useState('')
  const [result, setResult] = React.useState<SandboxResult>(() => scoreAgainstSample(''))

  React.useEffect(() => {
    const id = setTimeout(() => setResult(scoreAgainstSample(text)), DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [text])

  return (
    <section aria-labelledby="sandbox-heading" className="px-4 section-y">
      <div className="shell">
        <div className="mb-12 max-w-2xl lg:mb-14">
          <h2 id="sandbox-heading" className="text-section text-ink">
            Try it on a real job advert
          </h2>
          <p className="mt-4 max-w-[56ch] text-[16px] font-light leading-relaxed text-ink-dim">
            This scores a sample CV, not yours, and it runs in your browser. Nothing is uploaded
            and nothing is stored.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:gap-8">
          {/* ── Input ──────────────────────────────────────────────── */}
          <div className="flex flex-col gap-4">
            <div className="flex items-baseline justify-between gap-4">
              <label htmlFor="sandbox-jd" className="text-[13px] font-medium text-ink-subtle">
                The job description
              </label>
              <span className="text-micro text-ink-faint">{text.length} characters</span>
            </div>
            <textarea
              id="sandbox-jd"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={PLACEHOLDER}
              spellCheck={false}
              className="min-h-[22rem] w-full resize-y rounded-2xl bg-canvas p-6 text-[14px] font-light leading-relaxed text-ink field-ring placeholder:text-ink-faint outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            />
            <p className="text-[13px] leading-relaxed text-ink-faint">
              Scored against a sample CV: {SAMPLE_RESUME.title}, {SAMPLE_RESUME.yearsExperience}{' '}
              years, {SAMPLE_RESUME.skills.slice(0, 4).join(', ')} and others.
            </p>
          </div>

          {/* ── Result ─────────────────────────────────────────────── */}
          <div
            aria-live="polite"
            className="flex flex-col gap-7 rounded-2xl bg-canvas-raise p-[22px] elev-md lg:p-[30px]"
          >
            <div className="flex flex-wrap items-center gap-6">
              {/* No `key` here on purpose: remounting per score would replay
                  the fill from zero on every keystroke. Without it the arc
                  transitions between values, which is what a live panel
                  should do.

                  The empty state is NOT CHECKED rather than a real band. A
                  zero captioned "Weak" reads as though the sample CV failed,
                  when in fact nothing has been asked yet. */}
              <ScoreRing
                value={result.score}
                size={116}
                strokeWidth={10}
                label="Match"
                band={result.empty ? 'NOT CHECKED' : undefined}
              />
              <div className="min-w-[16ch] flex-1">
                <p className="text-card-title text-ink">{result.verdict}</p>
                <p className="mt-2 max-w-[36ch] text-[14px] font-light leading-relaxed text-ink-dim">
                  {result.explanation}
                </p>
              </div>
            </div>

            {/* Breakdown. Every component shows its reason, because a score
                without one tells you that you failed but not what to do. */}
            <ul className="flex flex-col gap-5">
              {result.components.map((component) => {
                const pct = component.max ? (component.earned / component.max) * 100 : 0
                return (
                  <li key={component.key}>
                    <div className="mb-2 flex items-baseline justify-between gap-3">
                      <span className="text-[13px] font-medium text-ink">{component.label}</span>
                      <span className="text-micro text-ink-dim">
                        {component.earned} of {component.max}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-canvas field-ring-soft">
                      <div
                        className="h-full rounded-full bg-[image:var(--gradient-accent)] transition-[width] duration-500 ease-(--ease-enter)"
                        style={{ width: pct + '%' }}
                      />
                    </div>
                    {component.reasons.length > 0 && (
                      <p className="mt-2 max-w-[52ch] text-[13px] font-light leading-relaxed text-ink-faint">
                        {component.reasons[0]}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>

            {!result.empty && (result.matched.length > 0 || result.missing.length > 0) && (
              <div className="flex flex-col gap-4">
                {result.matched.length > 0 && (
                  <div>
                    <p className="mb-2.5 text-[13px] font-medium text-ink">On the CV already</p>
                    <ul className="flex flex-wrap gap-2">
                      {result.matched.map((skill) => (
                        <li key={skill}>
                          <Chip readOnly>{skill}</Chip>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.missing.length > 0 && (
                  <div>
                    <p className="mb-2.5 text-[13px] font-medium text-ink">Asked for, and absent</p>
                    <ul className="flex flex-wrap gap-2">
                      {result.missing.map((skill) => (
                        <li key={skill}>
                          <Chip readOnly missing>
                            {skill}
                          </Chip>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
