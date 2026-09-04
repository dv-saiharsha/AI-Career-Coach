'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Briefcase, Clock, MapPin, Search, Sparkles } from 'lucide-react'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useToast } from '@/components/ui/toast'
import { getJobs, type JobFeed, type JobListing, type WorkMode } from '../../../lib/jobsData'
import { CompanyLogo } from '@/components/jobs/CompanyLogo'
import { ApplyTrackerButton } from '@/components/jobs/ApplyTrackerButton'
import { useApplyTracker } from '@/hooks/useApplyTracker'
import { JobDetailDrawer } from '@/components/jobs/JobDetailDrawer'
import { stashJobContext } from '@/lib/jobContext'
import { PageHeader } from '@/components/PageHeader'
import { createApplication, getUserProfile } from '@/lib/apiClient'
import { bandColor, bandLabel } from '@/lib/scoreBands'
import { hasAnyMatchScores, JOB_SORT_OPTIONS, sortJobs, type JobSortOption } from '@/lib/jobSort'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Reveal, RevealGroup } from '@/lib/reveal'

const MODE_FILTERS = ['All', 'Remote', 'Hybrid', 'On-site'] as const
type ModeFilter = (typeof MODE_FILTERS)[number]

// "Sponsored" reports what a posting SAYS, never what an employer will do —
// the hint is shown on hover so the badge isn't read as a guarantee.
const H1B_PILLS = [
  {
    value: 'explicitly_sponsored',
    label: 'Sponsors H-1B',
    hint: 'The posting states sponsorship is available. Always confirm at screening.',
  },
  {
    value: 'no_sponsorship',
    label: 'No sponsorship',
    hint: 'The posting states sponsorship is unavailable, or requires existing authorization.',
  },
] as const

const EXPERIENCE_PILLS = [
  { value: 'entry', label: 'Entry' },
  { value: 'mid', label: 'Mid' },
  { value: 'senior', label: 'Senior' },
  { value: 'lead', label: 'Lead' },
] as const

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
  Remote: 'text-(--color-ok) border-(--color-ok)/25 bg-(--color-ok)/5',
  Hybrid: 'text-(--color-accent) border-(--color-accent)/25 bg-(--color-accent)/5',
  'On-site': 'text-(--color-warn) border-(--color-warn)/25 bg-(--color-warn)/5',
}

// A search that misses the server cache costs a paid scraper run, so the input
// is debounced well past typing speed. This is a cost control, not just a
// perf nicety — firing per keystroke would bill for every prefix of a word.
const SEARCH_DEBOUNCE_MS = 600
// The listings are what this route exists to show, so they refresh in the
// background without anyone asking — hourly, not "whenever someone happens
// to reload the tab." Reuses retryTick rather than a second trigger: loading
// is derived from comparing loadedTerm to the current filter key, which an
// interval-driven retryTick bump never changes, so this refetches silently
// and only surfaces anything if it fails (the toast in the fetch effect
// below already covers that — one failure path, not two).

export default function JobsPage() {
  const router = useRouter()
  const toast = useToast()
  const [feed, setFeed] = useState<JobFeed | null>(null)
  // Mirrors `feed` for the fetch effect below to read without depending on
  // it. The effect is what writes `feed`, so putting the state itself in
  // its own dependency array would refire on every successful response —
  // a ref reads the latest value without being a reactive dependency.
  const [selectedJob, setSelectedJob] = useState<JobListing | null>(null)
  const [targetRoles, setTargetRoles] = useState<string[]>([])
  const [roleFilter, setRoleFilter] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [mode, setMode] = useState<ModeFilter>('All')
  // Enrichment filters are applied server-side: an unenriched row is excluded
  // by any filter on that attribute, which the backend can express and a
  // client-side .filter() over an already-paginated feed cannot.
  const [h1b, setH1b] = useState<string | null>(null)
  const [experience, setExperience] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  // Bumped by the retry button so the fetch effect below re-runs without
  // requiring the user to change a filter first — a "try again" that only
  // works if you also happen to alter your search is not really a retry.
  const [retryTick, setRetryTick] = useState(0)

  useEffect(() => {
    const AUTO_REFRESH_MS = 60 * 60 * 1000
    const id = setInterval(() => setRetryTick((n) => n + 1), AUTO_REFRESH_MS)
    return () => clearInterval(id)
  }, [])
  // The term `feed` actually corresponds to. Loading is derived from the gap
  // between this and searchTerm rather than held as its own state — setting a
  // loading flag synchronously in an effect triggers a cascading render.
  const [loadedTerm, setLoadedTerm] = useState<string | null>(null)
  // Keyed by job id so reopening a different listing shows its own state
  // rather than inheriting the last one's "Saved".
  const [saveStates, setSaveStates] = useState<Record<string, 'idle' | 'saving' | 'saved'>>({})
  const feedRef = useRef<JobFeed | null>(null)
  const loading = loadedTerm !== `${searchTerm}|${h1b ?? ''}|${experience ?? ''}`

  // Best Match becomes the default the first time a feed with any scored
  // listing arrives — then never again, so a later background refresh (or
  // a filter change that briefly returns an unscored feed) can't silently
  // override a sort the user picked themselves. "Preserve the existing
  // default ordering" is exactly what happens when this ref never fires:
  // sortBy stays 'newest', sortJobs treats that as "leave the feed alone."
  const [sortBy, setSortBy] = useState<JobSortOption>('newest')
  const defaultSortApplied = useRef(false)

  // Debounce the raw input down to the term we actually send.
  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    let cancelled = false
    getJobs(searchTerm || undefined, { h1b, experience })
      .then((data) => {
        // Guard against an earlier request resolving after a later one and
        // overwriting fresher results with stale ones.
        if (cancelled) return
        setFeed(data)
        feedRef.current = data
        setFailed(false)
      })
      .catch(() => {
        if (cancelled) return
        setFailed(true)
        // A fetch that fails while there is already a feed on screen is a
        // refresh failing, not a first load — the existing rows are simply
        // never overwritten below, so what is on screen keeps working. The
        // one thing missing without this is that nobody is told it happened:
        // silently serving stale data and silently failing to load both look
        // identical to a user who cannot tell whether it's about to update.
        if (feedRef.current) {
          toast({
            title: "Couldn't refresh listings",
            description: 'Showing your last results. This will retry automatically.',
            variant: 'error',
          })
        }
      })
      .finally(() => {
        // Always advance, including on failure — otherwise a failed request
        // leaves the grid stuck on the loading skeleton forever.
        if (!cancelled) setLoadedTerm(`${searchTerm}|${h1b ?? ''}|${experience ?? ''}`)
      })
    return () => {
      cancelled = true
    }
  }, [searchTerm, h1b, experience, retryTick, toast])

  useEffect(() => {
    if (defaultSortApplied.current || !feed) return
    if (hasAnyMatchScores(feed.jobs)) {
      defaultSortApplied.current = true
      /* eslint-disable-next-line react-hooks/set-state-in-effect -- one-time
         default derived from async data (the fetched feed), matching the
         same pattern already used above for consumeJobContext: this fires
         at most once (guarded by the ref), not on every render. */
      setSortBy('match')
    }
  }, [feed])

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

  // Sorted on top of the existing filter, never instead of it — every sort
  // option orders the same already-filtered set the grid already computed.
  const sorted = useMemo(() => sortJobs(filtered, sortBy), [filtered, sortBy])
  const showingBestMatch = sortBy === 'match' && hasAnyMatchScores(filtered)

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

  const applyTracker = useApplyTracker()

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
      <PageHeader
        eyebrow="Job Market"
        eyebrowIcon={Briefcase}
        title="Openings worth your scan."
        description="Fresh listings matched to the roles ApplyCenter coaches for."
      >
        {feed?.lastUpdated && (
          <span className="mt-2 inline-flex items-center gap-1.5 text-xs text-(--color-ink-faint)">
            <Clock className="w-3 h-3" aria-hidden="true" />
            {/* Both halves are measured now, where the previous copy could
                only claim one. "Checked hourly" used to describe this tab's
                own polling and deliberately said nothing about the listings,
                because the sweep that populates them had no enforced schedule
                — its comment was careful about exactly that.

                There is now a real hourly sweep server-side, so the next-sync
                time is read from the scheduler rather than implied. It is
                omitted entirely when that process is not running a sweeper,
                which keeps the honest-by-construction property: the UI never
                asserts a cadence nobody is keeping. */}
            Updated {refreshLabel(feed.lastUpdated)}
            {feed.next_sync_at ? ` · next sync ${refreshLabel(feed.next_sync_at)}` : ''}
          </span>
        )}
      </PageHeader>

      {/* Target-role quick filters. Rendered only once onboarding has
          supplied roles — an empty strip would just be dead space. */}
      {targetRoles.length > 0 && (
        <Reveal
         
         
         
          className="flex flex-wrap items-center gap-2"
        >
          <span className="text-xs text-(--color-ink-faint)">Your roles</span>
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
                    ? 'border-(--color-accent) bg-(--color-accent) text-(--color-on-accent)'
                    : 'border-(--color-canvas-line) text-(--color-ink-subtle) hover:border-(--color-line-strong)'
                }`}
              >
                {role}
              </button>
            )
          })}
        </Reveal>
      )}

      {/* Search + mode filters */}
      <Reveal
       
       
       
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

        <div>
          <label htmlFor="job-sort" className="sr-only">
            Sort jobs
          </label>
          <select
            id="job-sort"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as JobSortOption)}
            className="h-10 rounded-full border border-(--color-canvas-line) bg-(--color-canvas-raise) px-3.5 text-xs font-medium text-(--color-ink-dim) transition-colors hover:border-(--color-line-strong) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent)"
          >
            {JOB_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                Sort: {option.label}
              </option>
            ))}
          </select>
        </div>
      </Reveal>

      {/* States a manual choice as clearly as an automatic one — this only
          reflects sortBy, it never re-decides it. */}
      {showingBestMatch && (
        <Reveal as="p"
         
         
          className="flex items-center gap-1.5 text-xs text-(--color-ink-faint)"
        >
          <Sparkles className="w-3 h-3" aria-hidden="true" />
          Sorted by Best Match based on your latest resume.
        </Reveal>
      )}

      {/* Enrichment filters. Counts come from the unfiltered feed so a pill
          shows what it would match, and a zero-count pill is disabled rather
          than leading to an empty grid. */}
      {feed?.filterCounts && (
        <Reveal
         
         
          className="mb-5 flex flex-wrap items-center gap-2"
        >
          <span className="eyebrow text-[10px]">Sponsorship</span>
          {H1B_PILLS.map((pill) => {
            const count = feed.filterCounts?.h1b?.[pill.value] ?? 0
            const active = h1b === pill.value
            return (
              <button
                key={pill.value}
                type="button"
                disabled={count === 0 && !active}
                aria-pressed={active}
                onClick={() => setH1b(active ? null : pill.value)}
                className="chip transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                style={{
                  borderColor: active ? 'var(--color-accent)' : 'var(--color-canvas-line)',
                  color: active ? 'var(--color-accent)' : 'var(--color-ink-dim)',
                }}
                title={pill.hint}
              >
                {pill.label}
                <span className="text-(--color-ink-faint)">{count}</span>
              </button>
            )
          })}

          <span className="eyebrow ml-3 text-[10px]">Level</span>
          {EXPERIENCE_PILLS.map((pill) => {
            const count = feed.filterCounts?.experience?.[pill.value] ?? 0
            const active = experience === pill.value
            return (
              <button
                key={pill.value}
                type="button"
                disabled={count === 0 && !active}
                aria-pressed={active}
                onClick={() => setExperience(active ? null : pill.value)}
                className="chip transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                style={{
                  borderColor: active ? 'var(--color-accent)' : 'var(--color-canvas-line)',
                  color: active ? 'var(--color-accent)' : 'var(--color-ink-dim)',
                }}
              >
                {pill.label}
                <span className="text-(--color-ink-faint)">{count}</span>
              </button>
            )
          })}

          {(h1b || experience) && (
            <button
              type="button"
              onClick={() => { setH1b(null); setExperience(null) }}
              className="text-[10px] font-mono uppercase tracking-wide text-(--color-ink-faint) hover:text-(--color-ink)"
            >
              clear
            </button>
          )}

          {/* Stated rather than hidden: filters only cover classified rows,
              and a candidate should know how much of the feed that leaves out. */}
          {feed.filterCounts.unenriched > 0 && (
            <span className="ml-auto text-[10px] text-(--color-ink-faint)">
              {feed.filterCounts.unenriched} listing
              {feed.filterCounts.unenriched === 1 ? '' : 's'} not yet classified
            </span>
          )}
        </Reveal>
      )}

      {/* Listings.
          Wrapped in ErrorBoundary because this is where a shape mismatch in
          the feed payload would actually throw — job.title, job.company and
          friends read straight off each row with no guard, which is
          appropriate given the schema is typed, but a live API and a live
          client are not always deployed in lockstep. resetKeys means a crash
          on one search does not survive into a different one. */}
      <ErrorBoundary label="The job feed" resetKeys={[searchTerm, h1b, experience]}>
      {!feed || loading ? (
        <div className="grid sm:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card p-5 h-44 shimmer-bg" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="card p-10 text-center">
          <Briefcase className="w-8 h-8 text-(--color-ink-faint) mx-auto mb-3" />
          <div className="text-sm font-medium text-(--color-ink) mb-1">No matching openings</div>
          <p className="text-xs text-(--color-ink-dim)">
            {failed
              ? "Couldn't reach the job feed. Check your connection and try again."
              : searchTerm
                ? 'Nothing came back for that search. Try a broader role title.'
                : 'No listings are cached yet. Search a role to pull live results.'}
          </p>
          {failed && (
            <button
              type="button"
              onClick={() => setRetryTick((n) => n + 1)}
              className="btn-secondary mt-4 text-xs"
            >
              Try again
            </button>
          )}
        </div>
      ) : (
        <RevealGroup className="grid sm:grid-cols-2 gap-4">
          {sorted.map((job) => (
            <Reveal as="article"
              key={job.id}
             
             
             
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
              className="card-hover p-5 flex flex-col gap-4 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent)"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <CompanyLogo company={job.company} src={job.companyLogo} />
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-(--color-ink) truncate">{job.title}</h2>
                    <div className="text-xs text-(--color-ink-dim) flex items-center gap-1.5 mt-0.5">
                      <span>{job.company}</span>
                      <span className="text-(--color-canvas-line)">·</span>
                      <span className="inline-flex items-center gap-1 truncate">
                        <MapPin className="w-3 h-3 shrink-0" />
                        {job.location}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className={`text-[10px] font-medium px-2 py-1 rounded-full border ${MODE_STYLES[job.workMode]}`}>
                    {job.workMode}
                  </span>
                  {job.match?.overallMatch != null && job.match.band && (
                    <div className="flex flex-col items-end gap-0.5">
                      <span
                        className="text-base font-display font-semibold tabular-nums leading-none"
                        style={{ color: bandColor(job.match.band) }}
                      >
                        {Math.round(job.match.overallMatch)}
                      </span>
                      {/* The word, not just the number. A bare 64 means
                          nothing without the scale it sits on, and the band
                          is the same vocabulary every other score in the
                          product uses. */}
                      <span
                        className="text-[9px] uppercase tracking-wider"
                        style={{ color: bandColor(job.match.band) }}
                      >
                        {bandLabel(job.match.band)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {job.skills.map((skill) => (
                  <span key={skill} className="chip">{skill}</span>
                ))}
                {/* How many of this posting's skills the resume does not
                    evidence. Counted, not estimated — it is the length of the
                    list the matcher already produced, so the number and the
                    drawer that lists them cannot disagree. */}
                {(job.match?.skillsMatch?.missingSkills?.length ?? 0) > 0 && (
                  <span className="text-[10px] text-(--color-ink-faint)">
                    · {job.match!.skillsMatch!.missingSkills.length} gap
                    {job.match!.skillsMatch!.missingSkills.length === 1 ? '' : 's'}
                  </span>
                )}
              </div>

              {/* Sponsorship and seniority, both read off the posting rather
                  than inferred. Only rendered when a posting has actually
                  been classified — an unclassified role shows nothing, which
                  is different from showing "no sponsorship". */}
              {(job.h1bSponsorship === 'explicitly_sponsored' || job.experienceLevel) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {job.h1bSponsorship === 'explicitly_sponsored' && (
                    <span
                      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium bg-(--color-signal-bg) text-(--color-signal)"
                      title={job.h1bEvidence ?? undefined}
                    >
                      Sponsors H-1B
                    </span>
                  )}
                  {job.experienceLevel && (
                    <span className="text-[10px] uppercase tracking-wide text-(--color-ink-faint)">
                      {job.experienceLevel}
                    </span>
                  )}
                </div>
              )}

              {/* Why this score.
                  The matcher already writes an explanation and nothing showed
                  it. A score a candidate cannot interrogate is one they either
                  over-trust or dismiss, and this is the difference between a
                  number and a reason. <details> rather than React state: it
                  costs no render, works without JS, and is keyboard- and
                  screen-reader-navigable for free. */}
              {job.match?.explanation && (
                <details
                  className="group/why -mt-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <summary className="cursor-pointer list-none text-[11px] text-(--color-ink-dim) hover:text-(--color-ink) marker:hidden">
                    Why this score
                    <span className="ml-1 inline-block transition-transform group-open/why:rotate-90">›</span>
                  </summary>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-(--color-ink-dim)">
                    {job.match.explanation}
                  </p>
                </details>
              )}

              <div className="flex items-center justify-between mt-auto pt-1">
                <div className="text-xs text-(--color-ink-dim)">
                  <span className="font-medium text-(--color-ink)">{job.salaryRange}</span>
                  <span className="mx-1.5 text-(--color-canvas-line)">·</span>
                  {postedLabel(job.postedDaysAgo)}
                </div>
                {/* Now a real third-party URL, not the old '#' placeholder:
                    noopener/noreferrer keeps the opened page from reaching
                    back through window.opener (tabnabbing). */}
                {/* Stops propagation internally so the card's onClick does
                    not open the drawer behind the newly-opened tab. */}
                <ApplyTrackerButton
                  job={job}
                  state={applyTracker.stateFor(job)}
                  onApply={applyTracker.openAndTrack}
                  onUndo={applyTracker.undo}
                />
              </div>
            </Reveal>
          ))}
        </RevealGroup>
      )}
      </ErrorBoundary>

      <JobDetailDrawer
        job={selectedJob}
        isOpen={!!selectedJob}
        onClose={() => setSelectedJob(null)}
        applyState={selectedJob ? applyTracker.stateFor(selectedJob) : 'idle'}
        onApply={applyTracker.openAndTrack}
        onUndoApply={applyTracker.undo}
        onMatchResume={handleMatchResume}
        // Identical stash-then-navigate hand-off as Match — Quick Tailor on
        // /resume reads the same stashed context and needs the same real
        // description, not a manually-typed one. Reused rather than
        // duplicated: the two buttons land on the same page for the same
        // reason and only diverge in what the user does once there.
        onTailorResume={handleMatchResume}
        onPracticeInterview={handlePracticeInterview}
        onSaveToPipeline={handleSaveToPipeline}
        saveState={selectedJob ? (saveStates[selectedJob.id] ?? 'idle') : 'idle'}
      />
    </div>
  )
}
