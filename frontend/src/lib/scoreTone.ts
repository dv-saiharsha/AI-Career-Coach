export type ScoreTone = 'success' | 'warning' | 'danger'

// Consistent red/orange/green banding for every score ring in the app —
// top quarter is green, next quarter orange, bottom half red. `max` lets a
// 0-10 score (interview average) and a 0-100 score (ATS match) share the
// same proportional thresholds instead of each page inventing its own cutoffs.
export function getScoreTone(score: number | null | undefined, max = 100): ScoreTone {
  if (score == null || Number.isNaN(score)) return 'warning'
  const pct = (score / max) * 100
  if (pct >= 75) return 'success'
  if (pct >= 50) return 'warning'
  return 'danger'
}

export function scoreToneClass(tone: ScoreTone): string {
  return tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-destructive'
}
