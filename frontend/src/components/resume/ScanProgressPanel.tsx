'use client'

import { useEffect, useState } from 'react'
import { Check, ScanLine } from 'lucide-react'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'

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

const STAGE_INTERVAL_MS = 900
const FLAVOR_INTERVAL_MS = 1400

/**
 * Narrated progress for the scan request.
 *
 * Deliberately timer-driven rather than checkpoint-driven, unlike the tailor
 * workspace's stepper: /analyze is one atomic backend call with nothing
 * incremental to report, so there is no real progress to tie this to — a
 * narrated stage list is the honest option available, not a shortcut taken
 * in place of one.
 *
 * The timers live here rather than in the page because they are this
 * component's own narration. The page previously owned them and imported
 * STAGES/FLAVOR_LINES back out purely to read `.length` for its intervals —
 * an inverted dependency where the orchestrator reached into a presentational
 * component's copy. Mounting only happens while a scan is in flight, so mount
 * is start and unmount is stop.
 */
export function ScanProgressPanel() {
  const reduceMotion = usePrefersReducedMotion()
  const [stage, setStage] = useState(0)
  const [flavorIndex, setFlavorIndex] = useState(0)

  useEffect(() => {
    const id = setInterval(
      () => setStage((prev) => Math.min(STAGES.length - 1, prev + 1)),
      STAGE_INTERVAL_MS,
    )
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const id = setInterval(
      () => setFlavorIndex((prev) => Math.min(FLAVOR_LINES.length - 1, prev + 1)),
      FLAVOR_INTERVAL_MS,
    )
    return () => clearInterval(id)
  }, [])

  return (
    <div
     
     
     
      className="min-h-[60vh] flex items-center justify-center panel-enter"
    >
      {/* The whole narration is one live region: a screen reader gets the
          stage changes and the flavor line, not silence for several seconds. */}
      <div className="card px-8 py-10 max-w-[440px] w-full" role="status" aria-live="polite">
        <div className="eyebrow mb-6 justify-center flex items-center gap-2">
          <ScanLine strokeWidth={1.5} className="w-3.5 h-3.5" aria-hidden="true" />
          Scanning your document
        </div>

        {/* The document under the scanner. Four layers: the ruled page, a
            measurement grid, the beam, and the inner bloom that travels with
            it. Decorative in full — the live region below carries the state.

            The beam animates on translate3d rather than a moving gradient
            position, so several seconds of scanning costs the compositor a
            transform per frame instead of the browser a repaint. */}
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

          <div className="scan-grid absolute inset-0 opacity-40" />

          <div
            className="scan-beam absolute inset-x-0 top-0 h-[18px]"
            style={{
              background:
                'linear-gradient(180deg, transparent, color-mix(in srgb, var(--color-accent) 55%, transparent) 50%, transparent)',
              boxShadow: '0 0 14px 2px color-mix(in srgb, var(--color-accent) 30%, transparent)',
            }}
          />

          <div
            className="scan-bloom absolute inset-0"
            style={{ boxShadow: 'inset 0 0 26px color-mix(in srgb, var(--color-accent) 22%, transparent)' }}
          />
        </div>

        {/* Tracking readout. Monospace because the values change while it is
            being read, and a proportional face reflows every time they do. */}
        <div
          aria-hidden="true"
          className="mb-6 flex items-center justify-center gap-3 font-mono text-[10px] uppercase tracking-[0.14em] text-(--color-ink-faint)"
        >
          <span className="scan-pulse inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-(--color-accent)" />
            Live
          </span>
          <span className="tabular-nums">
            Pass {String(Math.min(stage + 1, STAGES.length)).padStart(2, '0')} / {String(STAGES.length).padStart(2, '0')}
          </span>
        </div>

        <div className="flex flex-col gap-2.5">
          {STAGES.map((label, i) => {
            const done = i < stage
            const current = i === stage
            return (
              <div key={label} className="flex items-center gap-3">
                <span className="relative flex items-center justify-center w-4 h-4 shrink-0" aria-hidden="true">
                  {done ? (
                    <Check strokeWidth={2} className="w-3.5 h-3.5 text-(--color-accent)" />
                  ) : (
                    <span
                      className="block w-[7px] h-[7px] rounded-full"
                      style={{ background: current ? 'var(--color-accent)' : 'var(--color-canvas-line)' }}
                    />
                  )}
                  {current && !reduceMotion && (
                    <span
                      className="absolute w-[7px] h-[7px] rounded-full panel-enter"
                      style={{ background: 'var(--color-accent)' }}
                     
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

        <div className="mt-6 pt-5 border-t border-(--color-canvas-line) h-5">
            <p
              key={flavorIndex}
             
             
             
             
              className="text-xs font-mono text-(--color-ink-faint) text-center panel-enter"
            >
              {FLAVOR_LINES[flavorIndex]}
            </p>
        </div>
      </div>
    </div>
  )
}
