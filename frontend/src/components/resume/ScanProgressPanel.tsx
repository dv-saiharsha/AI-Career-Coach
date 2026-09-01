'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-[60vh] flex items-center justify-center"
    >
      {/* The whole narration is one live region: a screen reader gets the
          stage changes and the flavor line, not silence for several seconds. */}
      <div className="card px-8 py-10 max-w-[440px] w-full" role="status" aria-live="polite">
        <div className="eyebrow mb-6 justify-center flex items-center gap-2">
          <ScanLine strokeWidth={1.5} className="w-3.5 h-3.5" aria-hidden="true" />
          Scanning your document
        </div>

        {/* Document silhouette with a repeating scan beam sweeping down it */}
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
          {!reduceMotion && (
            <motion.div
              className="absolute left-0 right-0 h-9"
              style={{
                background:
                  'linear-gradient(180deg, transparent, color-mix(in srgb, var(--color-accent) 35%, transparent) 50%, transparent)',
              }}
              initial={{ top: '-20%' }}
              animate={{ top: '110%' }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
            />
          )}
          <div
            className="absolute inset-0"
            style={{ boxShadow: 'inset 0 0 24px color-mix(in srgb, var(--color-accent) 12%, transparent)' }}
          />
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
                    <motion.span
                      className="absolute w-[7px] h-[7px] rounded-full"
                      style={{ background: 'var(--color-accent)' }}
                      animate={{ scale: [1, 2.2], opacity: [0.6, 0] }}
                      transition={{ duration: 1.1, repeat: Infinity, ease: 'easeOut' }}
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
          <AnimatePresence mode="wait">
            <motion.p
              key={flavorIndex}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25 }}
              className="text-xs font-mono text-(--color-ink-faint) text-center"
            >
              {FLAVOR_LINES[flavorIndex]}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  )
}
