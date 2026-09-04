'use client'

import { useEffect, useState } from 'react'
import { Check, ScanLine } from 'lucide-react'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'

/* Keyed to app/modules/resume_analyzer/services.py SCAN_STAGES, which is
   the server's own list and is asserted against the pipeline source there.
   A key here with no counterpart on the server is a checklist row that never
   ticks. */
const STAGES = [
  { key: 'extracting', label: 'Reading your resume' },
  { key: 'checking', label: 'Checking it parses as a CV' },
  { key: 'analyzing', label: 'Matching it to the job description' },
  { key: 'reconciling', label: 'Reconciling implied skills' },
  { key: 'diagnostics', label: 'Building your report' },
] as const

export const SCAN_STAGE_KEYS = STAGES.map((s) => s.key)

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
 * Checkpoint-driven now. /analyze publishes a stage event as each real step
 * begins — extract, pre-filter, the Claude call, reconcile, diagnostics —
 * and those arrive over the existing per-user SSE stream while the request
 * is still open.
 *
 * The timer that used to drive this is kept as a fallback rather than
 * deleted. The stream can be closed for reasons that have nothing to do with
 * the scan (a proxy dropped it, Redis is unavailable, the browser throttled a
 * background tab), and a checklist frozen on row one for twelve seconds is
 * worse than one that narrates. Whichever of the two is further along wins.
 *
 * Five stages are not five equal fifths: "analyzing" is the Claude call and
 * is most of the wall time. The checklist says which step is running, which
 * is true; it does not draw a bar implying even progress, which would not be.
 *
 * The timers live here rather than in the page because they are this
 * component's own narration. The page previously owned them and imported
 * STAGES/FLAVOR_LINES back out purely to read `.length` for its intervals —
 * an inverted dependency where the orchestrator reached into a presentational
 * component's copy. Mounting only happens while a scan is in flight, so mount
 * is start and unmount is stop.
 *
 * TWO PHASES, AND ONLY ONE OF THEM IS REAL
 *
 * `uploadPercent` is genuine: bytes acknowledged over XHR, which on a slow
 * connection with a 4MB PDF is most of the wait and is the part a
 * determinate bar should measure. It is shown as a real bar with a real
 * number.
 *
 * Once the bytes have landed, there is nothing to measure — the backend call
 * is atomic — and the narration above takes over. The two are deliberately
 * not merged into one bar that runs 0-100 twice, or one that crawls to 90%
 * and waits, which is the usual dishonest option: a bar that stops moving
 * reads as a hang, and a bar that lies about the second half teaches people
 * not to trust the first.
 */
export function ScanProgressPanel({
  uploadPercent,
  /** The stage key most recently reported by the server, if the event stream
   *  is delivering them. Undefined falls back to the timer below. */
  serverStage,
}: {
  uploadPercent?: number | null
  serverStage?: string | null
}) {
  const uploading = uploadPercent !== null && uploadPercent !== undefined && uploadPercent < 100
  const reduceMotion = usePrefersReducedMotion()
  const [timedStage, setTimedStage] = useState(0)
  const [flavorIndex, setFlavorIndex] = useState(0)

  /* The server's stage wins when it arrives. The timer is not removed with
     it: the SSE stream can be closed (a proxy dropped it, Redis is down, the
     browser throttled a background tab) and a checklist frozen on row one for
     twelve seconds is worse than one that narrates. So the timer keeps
     running underneath and whichever is further along is what shows —
     progress never goes backwards, and a live server stage always overtakes
     the timer because it means that step genuinely started. */
  /* The furthest stage the server has reported, not the most recent one.
     SSE frames can arrive late or out of order, and taking the latest made
     the checklist rewind — caught by a test, not by reading it: max(timer,
     latest) reads as monotonic and is not, because the timer is only a floor
     and a stale event still beats it once it has passed. A stage that has
     started cannot un-start, so the peak is the honest reading.

     A ref, and mounted per scan: the panel is keyed on the loading state, so
     it unmounts between scans and this resets with it. */
  const [peakReported, setPeakReported] = useState(-1)
  const reportedIndex = serverStage ? STAGES.findIndex((s) => s.key === serverStage) : -1
  // Adjusted during render, not in an effect: React re-runs the component
  // immediately with the new value, so the checklist never paints one frame
  // at the wrong stage. Same pattern the profile page uses to hydrate a form
  // from a query without a flash of the defaults.
  if (reportedIndex > peakReported) setPeakReported(reportedIndex)

  const stage = Math.max(timedStage, peakReported)
  const live = peakReported >= 0

  useEffect(() => {
    const id = setInterval(
      () => setTimedStage((prev) => Math.min(STAGES.length - 1, prev + 1)),
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
          {uploading ? 'Uploading your document' : 'Scanning your document'}
        </div>

        {/* The real half. A determinate bar, only while there is something
            determinate to report. */}
        {uploading && (
          <div className="mb-7">
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-canvas field-ring-soft"
              role="progressbar"
              aria-valuenow={uploadPercent ?? 0}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Upload progress"
            >
              <div
                className="h-full rounded-full bg-(--color-signal) transition-[width] duration-150 ease-out"
                style={{ width: `${uploadPercent ?? 0}%` }}
              />
            </div>
            <p className="mt-2 text-center text-[12px] tabular-nums text-ink-dim">
              {uploadPercent}% uploaded
            </p>
          </div>
        )}

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
          {/* "Live" only when it is. The word was there while the stages
              were on a timer, which is the kind of small dishonesty that
              costs trust when someone notices the checklist ticks at the
              same rate on a 200ms scan and a 20s one. */}
          <span className="scan-pulse inline-flex items-center gap-1.5">
            <span
              className="size-1.5 rounded-full"
              style={{ background: live ? 'var(--color-accent)' : 'var(--color-ink-faint)' }}
            />
            {live ? 'Live' : 'Working'}
          </span>
          <span className="tabular-nums">
            Pass {String(Math.min(stage + 1, STAGES.length)).padStart(2, '0')} / {String(STAGES.length).padStart(2, '0')}
          </span>
        </div>

        <div className="flex flex-col gap-2.5">
          {STAGES.map(({ key, label }, i) => {
            const done = i < stage
            const current = i === stage
            return (
              <div key={key} className="flex items-center gap-3">
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
