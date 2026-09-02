'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, Check, Loader2, ShieldAlert } from 'lucide-react'

import { getOptimizePlan, type OptimizePlan } from '@/lib/apiClient'
import { bandColor, bandForScore } from '@/lib/scoreBands'

/**
 * Where this resume can honestly go against this posting, and why it stops
 * where it stops.
 *
 * Replaces a card that used to sit here reading "Projected after fixes: 92%"
 * — computed client-side as matched-keywords-over-total, a number with no
 * relationship to the model that actually produces ats_score. Checking three
 * more skill chips could move that formula anywhere; it had never been run
 * past the model that grades the real thing. This calls optimizer.plan(),
 * which scores every step with the same model ats_score comes from.
 *
 * Fetched once per (analysisId, jobDescription) pair rather than staying in
 * sync with the skill-staging checklist above it: that checklist is about
 * deciding what to go address, this panel is about what the model can
 * confirm once you have. Conflating them was the bug.
 */
export function OptimizePlanPanel({
  analysisId,
  jobDescription,
}: {
  analysisId: number
  jobDescription: string
}) {
  const [result, setResult] = useState<
    { key: string; status: 'ready'; plan: OptimizePlan } | { key: string; status: 'error' } | null
  >(null)

  /* Keyed by the pair this result is for, and compared against the live pair
     at render time — the same pattern HeaderSearch uses, so a fetch that
     resolves after the inputs changed again is simply not shown, without a
     second "loading" flag racing this effect's own setState. */
  const key = `${analysisId}::${jobDescription}`
  const loading = result?.key !== key

  useEffect(() => {
    let cancelled = false
    getOptimizePlan(analysisId, jobDescription)
      .then((plan) => {
        if (!cancelled) setResult({ key, status: 'ready', plan })
      })
      .catch(() => {
        if (!cancelled) setResult({ key, status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [analysisId, jobDescription, key])

  if (loading) {
    return (
      <div className="card flex items-center gap-2.5 px-4 py-3 text-xs text-ink-faint">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        Checking what this resume can honestly reach against this posting…
      </div>
    )
  }

  if (result.status === 'error') {
    return null // Silent: this is a secondary panel, not the scan result itself.
  }

  const { plan } = result

  if (!plan.available) {
    return (
      <div className="card flex items-start gap-2.5 px-4 py-3">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-(--color-warning)" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-ink-dim">{plan.reason}</p>
      </div>
    )
  }

  const baselineBand = bandForScore(plan.baseline_score)
  const projectedBand = bandForScore(plan.projected_score)
  const appliedEdits = plan.edits.filter((edit) => edit.applied)
  const heldEdits = plan.edits.filter((edit) => !edit.applied && edit.requires_review)

  return (
    <div className="card space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 tabular-nums">
          <span
            className="rounded-md px-2 py-1 text-sm font-semibold"
            style={{ color: bandColor(baselineBand), background: `${bandColor(baselineBand)}15` }}
          >
            {plan.baseline_score}%
          </span>
          <ArrowRight className="size-3.5 text-ink-faint" aria-hidden="true" />
          <span
            className="rounded-md px-2 py-1 text-sm font-semibold"
            style={{ color: bandColor(projectedBand), background: `${bandColor(projectedBand)}15` }}
          >
            {plan.projected_score}%
          </span>
        </div>
        <span className="text-xs text-ink-faint">
          {plan.in_band
            ? `Reaches the ${plan.target_band[0]}–${plan.target_band[1]}% band honestly.`
            : plan.projected_score !== null && plan.baseline_score !== null && plan.projected_score > plan.baseline_score
              ? 'Every point above comes from something already in your resume.'
              : 'Nothing here could be improved without inventing something.'}
        </span>
      </div>

      {plan.beyond_meaningful && (
        <div className="flex items-start gap-2 rounded-md bg-canvas p-3 field-ring-soft">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-(--color-warning)" aria-hidden="true" />
          <p className="text-[12px] leading-relaxed text-ink-dim">
            Past about 85%, this model can no longer tell a genuine match from a
            keyword-stuffed one — a posting pasted back at itself scores in this
            same range. Treat this number as a ceiling, not a target to chase further.
          </p>
        </div>
      )}

      {appliedEdits.length > 0 && (
        <ul className="space-y-1.5">
          {appliedEdits.map((edit) => (
            <li key={edit.edit} className="flex items-start gap-2 text-[13px]">
              <Check className="mt-0.5 size-3.5 shrink-0 text-(--color-signal)" aria-hidden="true" />
              <span className="min-w-0 flex-1 text-ink-dim">{edit.label}</span>
              {edit.delta != null && (
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-faint">
                  {edit.delta > 0 ? '+' : ''}
                  {edit.delta}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {heldEdits.length > 0 && (
        <div className="border-t border-(--color-canvas-line) pt-3">
          <p className="mb-1.5 text-[10px] uppercase tracking-widest text-ink-faint">
            Only if you actually did this
          </p>
          <ul className="space-y-2">
            {heldEdits.map((edit) => (
              <li key={edit.edit} className="text-[12px] leading-relaxed text-ink-dim">
                <span className="font-medium text-ink">{edit.label}:</span> {edit.rationale}
                {edit.adds.length > 0 && (
                  <span className="ml-1 font-mono text-ink-faint">— {edit.adds.join(', ')}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-ink-faint">{plan.note}</p>
    </div>
  )
}
