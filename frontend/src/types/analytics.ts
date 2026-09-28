// Types mirroring backend/app/schemas/analytics.py exactly. Field names are
// snake_case on the wire — this schema has no camelCase mapping layer, same
// as backend/app/schemas/application.py.

/** One resume scan's ATS score, in chronological order. Labelled by
 *  resume_filename (`label`), not job title — resume_analyses has no
 *  job_title column, and the filename is what a user actually recognises
 *  across revisions ("ML_Engineer_v3.pdf"). */
export interface AtsHistoryPoint {
  id: number
  date: string | null
  score: number
  label: string
}

/** Quantified-bullet diagnostics for a scan. Both fields are 0-100 —
 *  quantified_ratio is the percentage of bullets carrying a real metric,
 *  impact_rating is the mean X-Y-Z structure grade across all bullets.
 *  Only scans saved after diagnostics shipped carry these — older scans are
 *  simply absent from this list, not reported as zero. */
export interface QuantifiedHistoryPoint {
  id: number
  date: string | null
  label: string
  quantified_ratio: number
  impact_rating: number
}

/** Application pipeline conversion. by_stage is where cards sit *right
 *  now*; reached_* counts are "ever reached at least this stage", which is
 *  why they don't line up with by_stage — a card rejected after an onsite
 *  still counts as having reached interviewing. Rates are null (not 0) when
 *  there's nothing to divide by, so "no data yet" never reads as "0%". */
export interface Funnel {
  by_stage: Record<string, number>
  total_tracked: number
  reached_applied: number
  reached_interviewing: number
  reached_offer: number
  interview_rate: number | null
  offer_rate: number | null
}

export interface AnalyticsSummary {
  ats_history: AtsHistoryPoint[]
  quantified_history: QuantifiedHistoryPoint[]
  funnel: Funnel
  scan_count: number
  best_score: number | null
  latest_score: number | null
  /** First-to-latest delta. Null with a single scan — one data point isn't
   *  a trend yet. */
  score_delta: number | null
}
