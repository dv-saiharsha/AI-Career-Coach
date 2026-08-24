// One-shot handoff of a job listing between routes.
//
// The jobs drawer stashes a listing, navigates, and the destination page
// consumes it on mount. localStorage rather than a query string because the
// payload includes the full posting description, which would blow past URL
// length limits and end up in server logs and browser history.
//
// Both sides live here so the key and shape can't drift: a writer and reader
// that disagree fail silently, leaving a button that navigates but does
// nothing visible.

import type { JobListing } from './apiClient'

const STORAGE_KEY = 'pending_job_context'

/** Job fields a destination page needs. Deliberately a subset — no need to
 *  round-trip skills or work mode through storage. */
export interface JobContext {
  id: string
  title: string
  company: string
  description: string | null
  applyUrl: string
}

export function stashJobContext(job: JobListing): void {
  // Guard for SSR and for privacy modes where localStorage throws on write.
  if (typeof window === 'undefined') return
  try {
    const context: JobContext = {
      id: job.id,
      title: job.title,
      company: job.company,
      description: job.description,
      applyUrl: job.applyUrl,
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(context))
  } catch {
    // A failed stash means the destination shows its normal empty state,
    // which is a degraded handoff rather than a broken page.
  }
}

/**
 * Read and clear the pending context.
 *
 * Consuming is destructive on purpose: without it, a stale listing would be
 * re-applied every subsequent visit to the destination page, silently
 * overwriting whatever the user had typed there.
 */
export function consumeJobContext(): JobContext | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    window.localStorage.removeItem(STORAGE_KEY)
    const parsed = JSON.parse(raw) as JobContext
    // Reject anything that doesn't carry the fields a consumer relies on,
    // so a stale or hand-edited entry can't half-populate a page.
    if (!parsed || typeof parsed.title !== 'string') return null
    return parsed
  } catch {
    return null
  }
}
