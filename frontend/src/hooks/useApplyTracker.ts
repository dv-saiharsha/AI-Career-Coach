'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  createApplication,
  deleteApplication,
  getApplicationPipeline,
  type JobListing,
} from '@/lib/apiClient'

/**
 * Records an application when the user opens a posting's Apply link.
 *
 * Worth being clear about what this claims, because the dashboard reads it:
 * opening a posting is evidence of intent, not proof of an application, and
 * every row created here counts toward "total applied". That number is built
 * from the sent stages precisely so bookmarks do not inflate it. Auto-tracking
 * trades some of that precision for not having to log anything by hand, which
 * is the deal the feature is making — so the trade is made reversible: every
 * auto-tracked row can be undone from the card that created it.
 *
 * Two things it will not do:
 *
 *   Create a second row for a posting already in the pipeline. The pipeline is
 *   read once on mount and keyed by URL, so this survives a reload rather than
 *   only deduping within one page session.
 *
 *   Delay opening the tab. window.open runs synchronously in the click
 *   handler, before any await. After an await the user-gesture context is
 *   gone and every major browser blocks the popup — the tracking call would
 *   succeed while the job posting silently failed to open.
 */
export type TrackState = 'idle' | 'tracking' | 'tracked' | 'existing' | 'failed'

export function useApplyTracker() {
  // Keyed by apply URL: the job cache ages out and re-scrapes under new row
  // ids, so a job id would stop matching a pipeline entry created last week.
  const trackedUrls = useRef<Map<string, number>>(new Map())
  const [states, setStates] = useState<Record<string, TrackState>>({})
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    getApplicationPipeline()
      .then((data) => {
        if (cancelled) return
        const seen = new Map<string, number>()
        for (const rows of Object.values(data.pipeline)) {
          for (const row of rows) {
            if (row.job_url) seen.set(row.job_url, row.id)
          }
        }
        trackedUrls.current = seen
        setReady(true)
      })
      .catch(() => {
        // A failed read means we cannot dedupe. Tracking still works; the
        // cost is a possible duplicate row, which the user can delete —
        // strictly better than blocking the Apply click on it.
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const stateFor = useCallback(
    (job: JobListing): TrackState => {
      const explicit = states[job.id]
      if (explicit) return explicit
      return trackedUrls.current.has(job.applyUrl) ? 'existing' : 'idle'
    },
    [states],
  )

  /** Call directly from the click handler — it opens the tab before awaiting. */
  const openAndTrack = useCallback((job: JobListing) => {
    // First statement in the handler's synchronous run. Everything below is
    // allowed to be slow; this is not.
    window.open(job.applyUrl, '_blank', 'noopener,noreferrer')

    if (trackedUrls.current.has(job.applyUrl)) {
      setStates((prev) => ({ ...prev, [job.id]: 'existing' }))
      return
    }

    setStates((prev) => ({ ...prev, [job.id]: 'tracking' }))
    createApplication({
      job_title: job.title,
      company: job.company,
      location: job.location,
      salary_range: job.salaryRange,
      job_url: job.applyUrl,
      // Carried so the application can be re-scored later without the
      // listing still being in the job cache, which ages out on a TTL.
      job_description: job.description,
      status: 'applied',
    })
      .then((row) => {
        trackedUrls.current.set(job.applyUrl, row.id)
        setStates((prev) => ({ ...prev, [job.id]: 'tracked' }))
      })
      .catch(() => {
        // The posting still opened, so this is not a failed action from the
        // user's point of view — only the bookkeeping missed.
        setStates((prev) => ({ ...prev, [job.id]: 'failed' }))
      })
  }, [])

  /** Removes a row this tracker created, for a click that wasn't an application. */
  const undo = useCallback((job: JobListing) => {
    const id = trackedUrls.current.get(job.applyUrl)
    if (id === undefined) return
    trackedUrls.current.delete(job.applyUrl)
    setStates((prev) => ({ ...prev, [job.id]: 'idle' }))
    deleteApplication(id).catch(() => {
      // Put it back rather than leaving the UI claiming a deletion that did
      // not happen — the row is still in the pipeline.
      trackedUrls.current.set(job.applyUrl, id)
      setStates((prev) => ({ ...prev, [job.id]: 'tracked' }))
    })
  }, [])

  return { stateFor, openAndTrack, undo, ready }
}
