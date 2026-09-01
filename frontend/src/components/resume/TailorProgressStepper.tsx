'use client'

import { Check, X } from 'lucide-react'

import type { ProgressStep, StepState } from '@/hooks/useTailorProgress'
import { Reveal } from '@/lib/reveal'

/**
 * Step-by-step progress for the tailoring pipeline.
 *
 * The steps are supplied by the caller and their states come from real
 * resolved work, which is the whole reason this takes props instead of owning
 * a `useState(2)` for the active step. A stepper that hardcodes step 2 as
 * current renders identically whether the backend answered instantly or
 * never — it shows the same frame while a counter climbs beside it, which
 * reads as progress and is not.
 *
 * The consequence worth knowing: there are three steps here, not five,
 * because the pipeline makes three calls. Sub-steps like "optimising keyword
 * density" would have to be invented, since the work happens inside one
 * request that reports nothing until it returns.
 */
export function TailorProgressStepper({
  steps,
  stateOf,
  elapsedMs,
  title = 'Tailoring your resume',
}: {
  steps: ProgressStep[]
  stateOf: (key: string) => StepState
  elapsedMs: number
  title?: string
}) {
  const seconds = Math.floor(elapsedMs / 1000)
  const failed = steps.some((s) => stateOf(s.key) === 'failed')
  const settled = steps.every((s) => {
    const state = stateOf(s.key)
    return state === 'done' || state === 'failed'
  })
  const active = steps.find((s) => stateOf(s.key) === 'active')

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between border-b border-[var(--color-canvas-line)] pb-3">
        <span className="eyebrow">
          {failed ? 'Stopped' : settled ? 'Done' : 'Tailoring…'}
        </span>
        {/* Wall-clock seconds. It stops when the work stops, so a stalled
            request shows a climbing number rather than a bar that quietly
            completes on schedule. */}
        <span className="font-mono text-xs text-[var(--color-ink-faint)]">{seconds}s</span>
      </div>

      <div className="mb-5 flex items-center gap-3">
        {settled ? (
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              failed ? 'bg-[var(--color-error)]' : 'bg-[var(--color-accent)]'
            }`}
          >
            {failed ? (
              <X strokeWidth={2.5} className="h-4 w-4 text-[var(--color-on-accent)]" />
            ) : (
              <Check strokeWidth={2.5} className="h-4 w-4 text-[var(--color-on-accent)]" />
            )}
          </span>
        ) : (
          <span className="h-9 w-9 shrink-0 animate-spin rounded-full border-2 border-[var(--color-canvas-line)] border-t-[var(--color-accent)]" />
        )}
        <div>
          <h3 className="text-sm font-medium text-[var(--color-ink)]">{title}</h3>
          {/* Says what is happening now rather than promising a duration.
              "Usually takes 15 to 30 seconds" is a number nobody measured,
              and it reads as broken the moment it is wrong. */}
          <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]">
            {failed
              ? 'Something failed. Nothing was saved.'
              : active
                ? active.description
                : settled
                  ? 'Finished.'
                  : 'Starting…'}
          </p>
        </div>
      </div>

      <ul className="space-y-3.5">
        {steps.map((step) => {
          const state = stateOf(step.key)
          return (
            <li key={step.key} className="flex items-start gap-3">
              <span className="pt-0.5">
                <StepMarker state={state} />
              </span>
              <div className="min-w-0">
                <p
                  className={`text-xs font-medium ${
                    state === 'active'
                      ? 'text-[var(--color-ink)]'
                      : state === 'done'
                        ? 'text-[var(--color-ink-dim)]'
                        : state === 'failed'
                          ? 'text-[var(--color-error)]'
                          : 'text-[var(--color-ink-faint)]'
                  }`}
                >
                  {step.label}
                  {state === 'failed' && ' — failed'}
                </p>
                {state === 'active' && (
                  <Reveal as="p"
                    className="mt-0.5 text-[11px] leading-snug text-[var(--color-accent)]"
                  >
                    {step.description}
                  </Reveal>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function StepMarker({ state }: { state: StepState }) {
  if (state === 'done') {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-accent)]">
        <Check strokeWidth={3} className="h-3 w-3 text-[var(--color-on-accent)]" />
      </span>
    )
  }
  if (state === 'failed') {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-[var(--color-error)]">
        <X strokeWidth={3} className="h-2.5 w-2.5 text-[var(--color-error)]" />
      </span>
    )
  }
  if (state === 'active') {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-[var(--color-accent)] bg-[var(--color-accent)]/15">
        <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-accent)]" />
      </span>
    )
  }
  return (
    <span className="block h-5 w-5 rounded-full border border-[var(--color-canvas-line)] bg-[var(--color-canvas-deep)]" />
  )
}
