'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Briefcase, Building2, Clock, ExternalLink, MapPin, Search } from 'lucide-react'
import { getJobs, type JobFeed, type JobListing, type WorkMode } from '../../../lib/jobsData'
import { JobDetailDrawer } from '@/components/jobs/JobDetailDrawer'
import { stashJobContext } from '@/lib/jobContext'
import { createApplication, getUserProfile } from '@/lib/apiClient'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

const MODE_FILTERS = ['All', 'Remote', 'Hybrid', 'On-site'] as const
type ModeFilter = (typeof MODE_FILTERS)[number]

function postedLabel(days: number): string {
  if (days <= 0) return 'Today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

function refreshLabel(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

const MODE_STYLES: Record<WorkMode, string> = {
  Remote: 'text-[var(--color-ok)] border-[var(--color-ok)]/25 bg-[var(--color-ok)]/5',
  Hybrid: 'text-[var(--color-accent)] border-[var(--color-accent)]/25 bg-[var(--color-accent)]/5',
  'On-site': 'text-[var(--color-warn)] border-[var(--color-warn)]/25 bg-[var(--color-warn)]/5',
}

// A search that misses the server cache costs a paid scraper run, so the input
// is debounced well past typing speed. This is a cost control, not just a
// perf nicety — firing per keystroke would bill for every prefix of a word.
const SEARCH_DEBOUNCE_MS = 600

export default function JobsPage() {
  const router = useRouter()
  const [feed, setFeed] = useState<JobFeed | null>(null)
  const [selectedJob, setSelectedJob] = useState<JobListing | null>(null)
  const [targetRoles, setTargetRoles] = useState<string[]>([])
  const [roleFilter, setRoleFilter] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [mode, setMode] = useState<ModeFilter>('All')
  const [failed, setFailed] = useState(false)
  // The term `feed` actually corresponds to. Loading is derived from the gap
  // between this and searchTerm rather than held as its own state — setting a
  // loading flag synchronously in an effect triggers a cascading render.
  const [loadedTerm, setLoadedTerm] = useState<string | null>(null)
  // Keyed by job id so reopening a different listing shows its own state
  // rather than inheriting the last one's "Saved".
  const [saveStates, setSaveStates] = useState<Record<string, 'idle' | 'saving' | 'saved'>>({})
  const loading = loadedTerm !== searchTerm

  // Debounce the raw input down to the term we actually send.
  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    let cancelled = false
    getJobs(searchTerm || undefined)
      .then((data) => {
        // Guard against an earlier request resolving after a later one and
        // overwriting fresher results with stale ones.
        if (cancelled) return
        setFeed(data)
        setFailed(false)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
      .finally(() => {
        // Always advance, including on failure — otherwise a failed request
        // leaves the grid stuck on the loading skeleton forever.
        if (!cancelled) setLoadedTerm(searchTerm)
      })
    return () => {
      cancelled = true
    }
  }, [searchTerm])

  // Target roles drive the quick-filter chips. Failure is silent: the chips
  // simply don't render, and the full feed still works.
  useEffect(() => {
    let cancelled = false
    getUserProfile()
      .then((profile) => {
        if (!cancelled) setTargetRoles(profile.target_roles)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    if (!feed) return []
    // When a search term is active the backend has already matched on it —
    // re-filtering client-side would wrongly hide results whose relevance
    // isn't a literal substring ("Machine Learning Engineer" for "ml engineer").
    return feed.jobs.filter((job) => mode === 'All' || job.workMode === mode)
  }, [feed, mode])

  // Stash the listing, then navigate. The destination reads it on mount via
  // consumeJobContext — see lib/jobContext.ts.
  const handleMatchResume = useCallback(
    (job: JobListing) => {
      stashJobContext(job)
      router.push('/resume')
    },
    [router],
  )

  const handlePracticeInterview = useCallback(
    (job: JobListing) => {
      // Role travels in the query string rather than storage: it's short,
      // and a shareable /interview?role=... link is genuinely useful.
      router.push(`/interview?role=${encodeURIComponent(job.title)}`)
    },
    [router],
  )

  const handleSaveToPipeline = useCallback(async (job: JobListing) => {
    setSaveStates((prev) => ({ ...prev, [job.id]: 'saving' }))
    try {
      await createApplication({
        job_title: job.title,
        company: job.company,
        location: job.location,
        salary_range: job.salaryRange,
        job_url: job.applyUrl,
        // Carried over so the application can be re-scored later without
        // needing the original listing to still be in the job cache, which
        // ages out on a TTL.
        job_description: job.description,
        status: 'saved',
      })
      setSaveStates((prev) => ({ ...prev, [job.id]: 'saved' }))
    } catch {
      // Back to idle so the button is retryable — leaving it disabled would
      // strand the user with no way to try again.
      setSaveStates((prev) => ({ ...prev, [job.id]: 'idle' }))
    }
  }, [])

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <span className="section-eyebrow-violet mb-3 inline-flex">
          <Briefcase className="w-3 h-3" />
          Job Market
        </span>
        <h1 className="text-2xl sm:text-3xl font-display font-semibold text-[var(--color-ink)] mb-1">
          Openings worth your scan.
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-sm text-[var(--color-ink-dim)]">
            Fresh listings matched to the roles Zenith coaches for.
          </p>
          {feed?.lastUpdated && (
            <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-faint)]">
              <Clock className="w-3 h-3" />
              Refreshed daily · last updated {refreshLabel(feed.lastUpdated)}
            </span>
          )}
        </div>
      </motion.div>

      {/* Target-role quick filters. Rendered only once onboarding has
          supplied roles — an empty strip would just be dead space. */}
      {targetRoles.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex flex-wrap items-center gap-2"
        >
          <span className="text-xs text-[var(--color-ink-faint)]">Your roles</span>
          {targetRoles.map((role) => {
            const active = roleFilter === role
            return (
              <button
                key={role}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  // Toggling off clears both the chip and the query, so the
                  // grid returns to the warm feed instead of an empty search.
                  //
                  // searchTerm is set here rather than derived from roleFilter
                  // in an effect: a click is already an event, so deriving it
                  // would add a render pass and the debounce delay for an
                  // interaction that should feel immediate.
                  const next = active ? null : role
                  setRoleFilter(next)
                  setQuery(next ?? '')
                  setSearchTerm(next ?? '')
                }}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-on-accent)]'
                    : 'border-[var(--color-canvas-line)] text-[var(--color-ink-subtle)] hover:border-[var(--color-line-strong)]'
                }`}
              >
                {role}
              </button>
            )
          })}
        </motion.div>
      )}

      {/* Search + mode filters */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="flex flex-col sm:flex-row gap-3"
      >
        <div className="flex-1">
          <label htmlFor="job-search" className="sr-only">
            Search jobs
          </label>
          <Input
            id="job-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, company, or skill…"
            startAdornment={<Search />}
          />
        </div>

        {/* Work-mode filter. Tabs gives roving-focus keyboard nav and the
            shared pill for free — this used to be four unlinked buttons. */}
        <Tabs value={mode} onValueChange={(v) => setMode(v as ModeFilter)}>
          <TabsList aria-label="Filter by work mode">
            {MODE_FILTERS.map((m) => (
              <TabsTrigger key={m} value={m}>
                {m}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </motion.div>

      {/* Listings */}
      {!feed || loading ? (
        <div className="grid sm:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card p-5 h-44 shimmer-bg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-10 text-center">
          <Briefcase className="w-8 h-8 text-[var(--color-ink-faint)] mx-auto mb-3" />
          <div className="text-sm font-medium text-[var(--color-ink)] mb-1">No matching openings</div>
          <p className="text-xs text-[var(--color-ink-dim)]">
            {failed
              ? "Couldn't reach the job feed. Check your connection and try again."
              : searchTerm
                ? 'Nothing came back for that search. Try a broader role title.'
                : 'No listings are cached yet. Search a role to pull live results.'}
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {filtered.map((job, i) => (
            <motion.article
              key={job.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * i, duration: 0.4 }}
              onClick={() => setSelectedJob(job)}
              // role/tabIndex/onKeyDown rather than a bare onClick: a
              // click-only card is invisible to keyboard and screen-reader
              // users, and the Apply link inside rules out wrapping the whole
              // card in a <button> (nested interactive elements).
              role="button"
              tabIndex={0}
              aria-label={`View details for ${job.title} at ${job.company}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setSelectedJob(job)
                }
              }}
              className="card-hover p-5 flex flex-col gap-4 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-[var(--color-accent-tint)] flex items-center justify-center shrink-0">
                    <Building2 className="w-4.5 h-4.5 text-[var(--color-accent)]" strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-[var(--color-ink)] truncate">{job.title}</h2>
                    <div className="text-xs text-[var(--color-ink-dim)] flex items-center gap-1.5 mt-0.5">
                      <span>{job.company}</span>
                      <span className="text-[var(--color-canvas-line)]">·</span>
                      <span className="inline-flex items-center gap-1 truncate">
                        <MapPin className="w-3 h-3 shrink-0" />
                        {job.location}
                      </span>
                    </div>
                  </div>
                </div>
                <span className={`shrink-0 text-[10px] font-medium px-2 py-1 rounded-full border ${MODE_STYLES[job.workMode]}`}>
                  {job.workMode}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {job.skills.map((skill) => (
                  <span key={skill} className="chip">{skill}</span>
                ))}
              </div>

              <div className="flex items-center justify-between mt-auto pt-1">
                <div className="text-xs text-[var(--color-ink-dim)]">
                  <span className="font-medium text-[var(--color-ink)]">{job.salaryRange}</span>
                  <span className="mx-1.5 text-[var(--color-canvas-line)]">·</span>
                  {postedLabel(job.postedDaysAgo)}
                </div>
                {/* Now a real third-party URL, not the old '#' placeholder:
                    noopener/noreferrer keeps the opened page from reaching
                    back through window.opener (tabnabbing). */}
                <a
                  href={job.applyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  // Without this the card's onClick also fires, opening the
                  // drawer behind the newly-opened tab.
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-accent)] hover:text-[var(--color-accent-light)] transition-colors"
                >
                  Apply
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </motion.article>
          ))}
        </div>
      )}

      <JobDetailDrawer
        job={selectedJob}
        isOpen={!!selectedJob}
        onClose={() => setSelectedJob(null)}
        onMatchResume={handleMatchResume}
        onPracticeInterview={handlePracticeInterview}
        onSaveToPipeline={handleSaveToPipeline}
        saveState={selectedJob ? (saveStates[selectedJob.id] ?? 'idle') : 'idle'}
      />
    </div>
  )
}
