/**
 * The one score-band vocabulary for the app, mirroring the backend's
 * `rubric.band()` (backend/app/modules/resume_analyzer/rubric.py) exactly —
 * same words, same thresholds. Before this, ScoreRing computed its own
 * Strong/Competitive/Needs work/At risk bands at 80/60/40, independently of
 * whatever band string the API had already sent, so the same score could
 * read two different ways in the same feature. There is exactly one place
 * now that decides what a score means; everything else asks it.
 */

export type ScoreBand = 'EXCELLENT' | 'STRONG' | 'GOOD' | 'NEEDS WORK' | 'WEAK' | 'NOT CHECKED'

/** Same cutoffs as rubric.band() — do not nudge one without the other. */
export function bandForScore(score: number | null): ScoreBand {
  if (score === null) return 'NOT CHECKED'
  if (score >= 85) return 'EXCELLENT'
  if (score >= 70) return 'STRONG'
  if (score >= 55) return 'GOOD'
  if (score >= 35) return 'NEEDS WORK'
  return 'WEAK'
}

/** Sentence case for UI copy — the backend's own strings stay upper case for
 *  its inspectable-by-design rubric output, but shouting isn't this app's
 *  visual language. */
export function bandLabel(band: ScoreBand): string {
  switch (band) {
    case 'EXCELLENT':
      return 'Excellent'
    case 'STRONG':
      return 'Strong'
    case 'GOOD':
      return 'Good'
    case 'NEEDS WORK':
      return 'Needs work'
    case 'WEAK':
      return 'Weak'
    case 'NOT CHECKED':
      return 'Not checked'
  }
}

/** Four semantic buckets, not five — EXCELLENT and STRONG share a colour on
 *  purpose. A fifth hue would be invented for this alone, and the existing
 *  four already read as good → concerning.
 *
 *  GOOD is the accent rather than a fifth hue. That is inside the
 *  one-accent rule: the accent carries data emphasis as well as action, and
 *  it used to point at --data-3, which is now the same green as --success —
 *  GOOD and STRONG would have rendered identically.
 *
 *  Every value here is a text token measured against all four surfaces in
 *  both themes (scripts/check-contrast.mjs), because these colour the band
 *  caption as well as the arc. */
export function bandColor(band: ScoreBand): string {
  switch (band) {
    case 'EXCELLENT':
    case 'STRONG':
      return 'var(--success)'
    case 'GOOD':
      /* Signal, not ink. GOOD is the band with no semantic verdict attached —
         not a success, not a warning — so it takes the system's one neutral
         hue rather than the text colour, which would render it as unstyled. */
      return 'var(--signal)'
    case 'NEEDS WORK':
      return 'var(--warning)'
    case 'WEAK':
      return 'var(--danger)'
    case 'NOT CHECKED':
      return 'var(--ink-faint)'
  }
}
