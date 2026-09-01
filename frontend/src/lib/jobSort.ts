// Job feed sorting — deliberately its own module rather than logic inside
// jobs/page.tsx, so a Dashboard "your top matches" widget or a future
// Career Coach reference can sort the same JobListing[] the same way
// without importing a page component.

import type { JobListing } from './apiClient'

export type JobSortOption = 'match' | 'newest' | 'recent' | 'salary' | 'company'

export const JOB_SORT_OPTIONS: { value: JobSortOption; label: string }[] = [
  { value: 'match', label: 'Best Match' },
  { value: 'newest', label: 'Newest' },
  { value: 'recent', label: 'Recently Posted' },
  { value: 'salary', label: 'Salary' },
  { value: 'company', label: 'Company' },
]

/**
 * Midpoint of a "$X - $Y" range, or the single number in "$X" — the
 * closest thing to one comparable value a free-text salary string offers.
 * `null` for anything unparseable ("Not disclosed", empty, no digits),
 * and unparseable values always sort last regardless of direction: an
 * unknown salary is not a low salary, and ranking it as one would be
 * exactly the kind of unexplained number this app avoids showing.
 */
export function parseSalaryMidpoint(salaryRange: string | null | undefined): number | null {
  if (!salaryRange) return null
  const numbers = salaryRange.match(/[\d,]+(?:\.\d+)?/g)
  if (!numbers || numbers.length === 0) return null
  const parsed = numbers.map((n) => Number(n.replace(/,/g, ''))).filter((n) => Number.isFinite(n) && n > 0)
  if (parsed.length === 0) return null
  return parsed.reduce((a, b) => a + b, 0) / parsed.length
}

/** Whether the feed has at least one scored listing — the signal for
 *  whether defaulting to "Best Match" would show anything meaningful. */
export function hasAnyMatchScores(jobs: JobListing[]): boolean {
  return jobs.some((job) => job.match?.overallMatch != null)
}

/**
 * Descending numeric compare with nulls always last, regardless of what the
 * two real values would otherwise say — an unscored/unparseable row is not
 * "worst", it's unknown, and unknown must not silently rank as worst or
 * best depending on sort direction. `tieBreak` keeps the sort stable when
 * both sides are null (or genuinely equal) by falling back to original
 * feed position, so re-sorting the same feed never reshuffles ties.
 */
function compareDescendingNullsLast(a: number | null, b: number | null, tieBreak: number): number {
  if (a == null && b == null) return tieBreak
  if (a == null) return 1
  if (b == null) return -1
  return b - a || tieBreak
}

/**
 * Sorts a copy of `jobs`; never mutates the input.
 *
 * 'newest' is not really a sort — it's "leave the feed's own order alone",
 * which is deliberately also what happens when `sortBy` is unset. This is
 * the literal implementation of "preserve the existing default ordering."
 */
export function sortJobs(jobs: JobListing[], sortBy: JobSortOption): JobListing[] {
  if (sortBy === 'newest') return [...jobs]

  const indexed = jobs.map((job, index) => ({ job, index }))

  switch (sortBy) {
    case 'match':
      indexed.sort((a, b) =>
        compareDescendingNullsLast(a.job.match?.overallMatch ?? null, b.job.match?.overallMatch ?? null, a.index - b.index),
      )
      break
    case 'recent':
      indexed.sort((a, b) => a.job.postedDaysAgo - b.job.postedDaysAgo || a.index - b.index)
      break
    case 'salary':
      indexed.sort((a, b) =>
        compareDescendingNullsLast(parseSalaryMidpoint(a.job.salaryRange), parseSalaryMidpoint(b.job.salaryRange), a.index - b.index),
      )
      break
    case 'company':
      indexed.sort((a, b) => a.job.company.localeCompare(b.job.company) || a.index - b.index)
      break
  }

  return indexed.map((entry) => entry.job)
}
