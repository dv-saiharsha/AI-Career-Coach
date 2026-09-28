import type { FunnelSchema } from '@/types/dashboard'

export interface FunnelStage {
  stage: string
  count: number
  fill: string
}

/* Backend tracks 12 granular statuses but only computes cumulative "ever
   reached" totals for 3 checkpoints (applied / interviewing / offer) — see
   analytics/services.py's `_reached()`. Figma's mock funnel has 5 bars
   (Saved/Applied/Screening/Interview/Offer); splitting "interviewing" into
   Screening + Interview would require per-status cumulative reach the
   backend doesn't compute, and faking it from the non-cumulative `by_stage`
   snapshot would break the funnel's monotonically-decreasing shape. So this
   is 4 real, monotonic bars instead of 5 fabricated ones. */
export function buildFunnelStages(funnel: FunnelSchema): FunnelStage[] {
  return [
    { stage: 'Saved', count: funnel.total_tracked, fill: 'hsl(var(--chart-indigo-tint-strong))' },
    { stage: 'Applied', count: funnel.reached_applied, fill: 'hsl(var(--chart-indigo-soft))' },
    { stage: 'Interviewing', count: funnel.reached_interviewing, fill: 'hsl(var(--primary))' },
    { stage: 'Offer', count: funnel.reached_offer, fill: 'hsl(var(--success))' },
  ]
}
