// Job Market data layer.
//
// The live feed has landed: getJobs() now proxies to the FastAPI backend
// (GET /api/jobs), which serves listings scraped from Google Jobs via Apify
// and cached in Postgres. The sample listings that used to live here are gone.
//
// Types are re-exported from apiClient so existing importers keep working —
// apiClient is where the rest of the app's API types live, and duplicating
// these two interfaces is how they'd drift.

export type { JobFeed, JobListing, WorkMode } from './apiClient'

import { getJobs as fetchJobs, type JobFeed } from './apiClient'

/**
 * Fetch listings.
 *
 * No argument -> the warm-role cache (free, instant, never calls the scraper).
 * With a role -> that role specifically; a cache miss costs a scraper run
 * server-side, so debounce this rather than calling it per keystroke.
 */
export async function getJobs(query?: string): Promise<JobFeed> {
  return fetchJobs(query)
}
