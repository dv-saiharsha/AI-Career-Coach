import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ArrowRight,
  Bookmark,
  Briefcase,
  Check,
  ChevronDown,
  Clock,
  Copy,
  Loader2,
  MapPin,
  RefreshCcw,
  Search,
  Sparkles,
  SlidersHorizontal,
  Wand2,
} from 'lucide-react'
import { resumeService } from '@/services/resumeService'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { ScoreRing } from '@/components/shared/ScoreRing'
import { HttpError } from '@/lib/http'
import { cn } from '@/lib/utils'
import { jobsService } from '@/services/jobsService'
import {
  EMPLOYMENT_OPTIONS,
  EXPERIENCE_OPTIONS,
  H1B_OPTIONS,
  type EmploymentType,
  type ExperienceLevel,
  type H1bSponsorship,
  type JobFeed,
  type JobListing,
  type WorkMode,
} from '@/types/jobs'

const PAGE_SIZE = 10
const SEARCH_DEBOUNCE_MS = 500
// A stale-but-cached feed is served immediately while the backend queues a
// live scrape in the background (see job_market/services.get_jobs). Polling
// a few times gives that scrape a chance to land without the user having to
// manually retry, but stops rather than polling forever.
const POLL_MS = 4000
const MAX_POLLS = 4
const DESCRIPTION_CLAMP_CHARS = 700

const WORK_MODES: WorkMode[] = ['Remote', 'Hybrid', 'On-site']

type DatePostedBucket = 'today' | 'week' | 'month'
const DATE_POSTED_OPTIONS: { value: DatePostedBucket; label: string; maxDays: number }[] = [
  { value: 'today', label: 'Past 24 hours', maxDays: 1 },
  { value: 'week', label: 'Past week', maxDays: 7 },
  { value: 'month', label: 'Past month', maxDays: 30 },
]

type SortKey = 'best' | 'newest' | 'salary'

type TrackState = 'idle' | 'saving' | 'saved' | 'failed'

const BAND_HEADLINE: Record<string, string> = {
  EXCELLENT: 'Excellent match',
  STRONG: 'Strong match',
  GOOD: 'Good match',
  'NEEDS WORK': 'Partial match',
  WEAK: 'Weak match',
}

function matchHeadline(band: string | null | undefined): string {
  return (band && BAND_HEADLINE[band]) || 'Match score'
}

function toneClasses(score: number): { bar: string; text: string } {
  if (score >= 55) return { bar: 'bg-success', text: 'text-success' }
  if (score >= 35) return { bar: 'bg-warning', text: 'text-warning' }
  return { bar: 'bg-destructive', text: 'text-destructive' }
}

// Postings only carry day-granularity age (JobListingSchema.postedDaysAgo),
// so "today" covers anything under 24h rather than Figma's fabricated
// hour-level mock timestamps.
function relativeDayLabel(days: number): string {
  if (days <= 0) return 'Today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

function timeLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  } catch {
    return iso
  }
}

// salaryRange is a free-text string from the source ("$168k–$238k", "Not
// disclosed", hourly rates, etc.) — this extracts real $k figures already in
// that string for the min-salary filter and salary sort, rather than
// inventing a number. Returns null when nothing parses, so those listings can
// be excluded from a floor rather than silently miscounted.
function parseSalaryBounds(range: string): { min: number; max: number } | null {
  const found = [...range.matchAll(/\$([\d,.]+)\s*k/gi)].map((m) => Number(m[1].replace(/,/g, '')) * 1000)
  if (found.length === 0) return null
  return { min: Math.min(...found), max: Math.max(...found) }
}

function sortJobs(jobs: JobListing[], sort: SortKey): JobListing[] {
  const copy = [...jobs]
  if (sort === 'newest') {
    copy.sort((a, b) => a.postedDaysAgo - b.postedDaysAgo)
  } else if (sort === 'salary') {
    copy.sort((a, b) => {
      const av = parseSalaryBounds(a.salaryRange)?.max ?? -1
      const bv = parseSalaryBounds(b.salaryRange)?.max ?? -1
      return bv - av
    })
  } else {
    copy.sort((a, b) => (b.match?.overallMatch ?? -1) - (a.match?.overallMatch ?? -1))
  }
  return copy
}

// Frequency-ranked distinct values from the currently loaded feed, so the
// Role / Location dropdowns only ever offer choices that actually match
// something real right now instead of a fixed, possibly-empty mock list.
function topValues(jobs: JobListing[], key: 'title' | 'location', cap = 10): string[] {
  const counts = new Map<string, number>()
  for (const job of jobs) {
    const value = job[key]
    if (!value) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, cap).map(([value]) => value)
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof HttpError ? err.message : fallback
}

function initials(company: string): string {
  return (company || '?').trim().charAt(0).toUpperCase()
}

/** Best-effort brand icon with a monogram fallback. `logoUrl` may 404 (the
 * backend guesses a domain from the company name), so the fallback initial
 * is always underneath and only hidden once the image actually paints. */
function CompanyMark({ company, logoUrl }: { company: string; logoUrl?: string | null }) {
  const [failed, setFailed] = useState(false)
  const showImage = Boolean(logoUrl) && !failed

  return (
    <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
      <span className="text-sm font-semibold text-muted-foreground" aria-hidden={showImage}>
        {initials(company)}
      </span>
      {showImage && (
        // eslint-disable-next-line jsx-a11y/img-redundant-alt
        <img
          src={logoUrl ?? undefined}
          alt=""
          aria-hidden="true"
          width={40}
          height={40}
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-contain p-1.5"
        />
      )}
    </div>
  )
}

function AiBadge({ label = 'AI' }: { label?: string }) {
  return (
    <span className="inline-flex w-fit items-center gap-[5px] rounded-full bg-coral-tint px-[7px] py-1 text-[9px] font-extrabold uppercase tracking-[0.07em] text-coral-foreground">
      <Sparkles size={11} strokeWidth={2.5} /> {label}
    </span>
  )
}

function FilterSection({
  label,
  chevron,
  children,
}: {
  label: string
  chevron?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-[9px] border-t border-border py-[14px] first:border-t-0">
      <span className="flex items-center justify-between text-[13px] font-bold text-foreground">
        {label}
        {chevron && <ChevronDown size={14} className="text-muted-foreground" />}
      </span>
      {children}
    </div>
  )
}

interface FilterCheckboxProps {
  label: string
  checked: boolean
  onChange: () => void
  count?: number
  title?: string
}

function FilterCheckbox({ label, checked, onChange, count, title }: FilterCheckboxProps) {
  const disabled = count === 0 && !checked
  return (
    <label
      title={title}
      className={cn(
        'flex cursor-pointer items-center gap-[7px] text-[11px] text-secondary-foreground/90 text-muted-foreground',
        disabled && 'cursor-not-allowed opacity-40'
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="sr-only"
      />
      <span
        className={cn(
          'grid h-4 w-4 shrink-0 place-items-center rounded border border-border text-white transition-colors',
          checked && 'border-primary bg-primary'
        )}
      >
        {checked && <Check size={11} strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground/80">{label}</span>
      {count !== undefined && <span className="text-[9px] text-muted-foreground/70">{count}</span>}
    </label>
  )
}

interface JobCardProps {
  job: JobListing
  trackState: TrackState
  applied: boolean
  onOpen: (job: JobListing) => void
  onTrack: (job: JobListing) => void
  onApply: (job: JobListing) => void
}

function JobCard({ job, trackState, applied, onOpen, onTrack, onApply }: JobCardProps) {
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => onOpen(job)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(job)
        }
      }}
      aria-label={`View details for ${job.title} at ${job.company}`}
      className="grid cursor-pointer grid-cols-1 items-center gap-x-[13px] gap-y-3 p-[17px] transition-all duration-150 hover:-translate-y-px hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:grid-cols-[42px_1fr_72px_auto]"
    >
      <CompanyMark company={job.company} logoUrl={job.companyLogo} />

      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-heading text-[13px] font-bold text-foreground">{job.title}</h3>
            <span className="text-[11px] text-muted-foreground">{job.company}</span>
          </div>
          <span className="shrink-0 text-[8px] text-muted-foreground">{relativeDayLabel(job.postedDaysAgo)}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-[15px] gap-y-1 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <MapPin size={13} /> {job.location}
          </span>
          <span className="inline-flex items-center gap-1">
            <Briefcase size={13} /> {job.salaryRange}
          </span>
          {job.h1bSponsorship === 'explicitly_sponsored' && (
            <Badge variant="success" className="px-1.5 py-0 text-[8px]" title={job.h1bEvidence ?? undefined}>
              Sponsors H-1B
            </Badge>
          )}
        </div>
        {job.skills.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-[5px]">
            {job.skills.slice(0, 6).map((skill) => (
              <span key={skill} className="rounded-full bg-muted px-[7px] py-1 text-[8px] font-semibold text-muted-foreground">
                {skill}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 lg:flex-col lg:justify-center lg:gap-[3px]">
        {job.match?.overallMatch != null ? (
          <>
            <ScoreRing score={job.match.overallMatch} size="sm" variant="ats" showPercentageSign={false} />
            <span className="text-[7px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">match</span>
          </>
        ) : (
          <span className="max-w-[64px] text-center text-[8px] leading-tight text-muted-foreground">No match yet</span>
        )}
      </div>

      <div className="flex items-center gap-[7px]" onClick={(e) => e.stopPropagation()}>
        <Button
          variant={trackState === 'saved' ? 'subtle' : 'outline'}
          size="icon"
          aria-label="Save job"
          disabled={trackState === 'saving' || trackState === 'saved'}
          onClick={() => onTrack(job)}
        >
          {trackState === 'saving' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Bookmark className="h-4 w-4" fill={trackState === 'saved' ? 'currentColor' : 'none'} />
          )}
        </Button>
        <Button onClick={() => onApply(job)} className="gap-1.5 whitespace-nowrap">
          {applied ? (
            <>
              <Check size={15} /> Applied
            </>
          ) : (
            <>
              Quick Apply <ArrowRight size={15} />
            </>
          )}
        </Button>
      </div>
    </Card>
  )
}

function JobCardSkeleton() {
  return (
    <Card className="grid grid-cols-1 items-center gap-x-[13px] gap-y-3 p-[17px] lg:grid-cols-[42px_1fr_72px_auto]">
      <Skeleton className="h-10 w-10 rounded-lg" />
      <div className="min-w-0 space-y-2">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
        <div className="flex gap-1.5 pt-1">
          <Skeleton className="h-4 w-14 rounded-full" />
          <Skeleton className="h-4 w-16 rounded-full" />
        </div>
      </div>
      <Skeleton className="h-12 w-12 rounded-full justify-self-center" />
      <div className="flex gap-2">
        <Skeleton className="h-[38px] w-[38px] rounded-md" />
        <Skeleton className="h-[38px] w-[118px] rounded-md" />
      </div>
    </Card>
  )
}

export function JobsPage() {
  const navigate = useNavigate()

  // Search — the free-text query real backend search runs on. The sidebar's
  // "Role" select just sets this same state, so picking a role reuses the
  // exact same billed /jobs?q= path as typing it in.
  const [query, setQuery] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  // Server-side filters — forwarded to jobsService.getJobs exactly as before.
  const [h1b, setH1b] = useState<H1bSponsorship | null>(null)
  const [experience, setExperience] = useState<ExperienceLevel | null>(null)
  const [employment, setEmployment] = useState<EmploymentType | null>(null)
  const [company, setCompany] = useState<string | null>(null)

  // Client-side filters — narrow the single fetched feed, same pattern the
  // old work-mode tabs already used.
  const [workStyles, setWorkStyles] = useState<Set<WorkMode>>(new Set())
  const [locationFilter, setLocationFilter] = useState<string | null>(null)
  const [minSalaryK, setMinSalaryK] = useState(0)
  const [datePosted, setDatePosted] = useState<DatePostedBucket | null>(null)
  const [sort, setSort] = useState<SortKey>('best')
  const [filtersOpen, setFiltersOpen] = useState(true)

  const [feed, setFeed] = useState<JobFeed | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [retryTick, setRetryTick] = useState(0)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [selectedJob, setSelectedJob] = useState<JobListing | null>(null)
  const [descExpanded, setDescExpanded] = useState(false)
  const [trackStates, setTrackStates] = useState<Record<string, TrackState>>({})
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set())

  const pollCount = useRef(0)

  // Debounce the raw input down to the term actually sent to the API — a
  // search that misses the server cache costs a billed scraper run, so this
  // guards against firing on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [searchTerm, h1b, experience, employment, company, workStyles, locationFilter, minSalaryK, datePosted])

  useEffect(() => {
    pollCount.current = 0
  }, [searchTerm, h1b, experience, employment, company])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    jobsService
      .getJobs({
        q: searchTerm || undefined,
        h1b: h1b ?? undefined,
        experience: experience ?? undefined,
        employment: employment ?? undefined,
        company: company ?? undefined,
      })
      .then((data) => {
        if (cancelled) return
        setFeed(data)
        setFailed(false)
      })
      .catch((err) => {
        if (cancelled) return
        setFailed(true)
        toast.error(errorMessage(err, "Couldn't load job listings."))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, h1b, experience, employment, company, retryTick])

  // A background scrape may be running for a search that missed the cache.
  // Poll a bounded number of times so a fresh result can replace the
  // fallback feed without the user re-triggering anything themselves.
  useEffect(() => {
    if (!feed?.refreshing || pollCount.current >= MAX_POLLS) return
    const timer = setTimeout(() => {
      pollCount.current += 1
      setRetryTick((n) => n + 1)
    }, POLL_MS)
    return () => clearTimeout(timer)
  }, [feed])

  useEffect(() => {
    setDescExpanded(false)
  }, [selectedJob])

  const roleOptions = useMemo(() => topValues(feed?.jobs ?? [], 'title'), [feed])
  const locationOptions = useMemo(() => topValues(feed?.jobs ?? [], 'location'), [feed])
  const employerChips = feed?.filterCounts ? Object.entries(feed.filterCounts.employer) : []

  const filteredJobs = useMemo(() => {
    if (!feed) return []
    let rows = feed.jobs
    if (workStyles.size > 0) rows = rows.filter((job) => workStyles.has(job.workMode))
    if (locationFilter) rows = rows.filter((job) => job.location === locationFilter)
    if (minSalaryK > 0) {
      rows = rows.filter((job) => (parseSalaryBounds(job.salaryRange)?.min ?? -1) >= minSalaryK * 1000)
    }
    if (datePosted) {
      const bucket = DATE_POSTED_OPTIONS.find((opt) => opt.value === datePosted)!
      rows = rows.filter((job) => job.postedDaysAgo <= bucket.maxDays)
    }
    return sortJobs(rows, sort)
  }, [feed, workStyles, locationFilter, minSalaryK, datePosted, sort])

  const visibleJobs = filteredJobs.slice(0, visibleCount)
  const hasMore = visibleCount < filteredJobs.length
  const anyFilterActive = Boolean(
    query || h1b || experience || employment || company || workStyles.size > 0 || locationFilter || minSalaryK > 0 || datePosted
  )

  const clearFilters = () => {
    setQuery('')
    setSearchTerm('')
    setH1b(null)
    setExperience(null)
    setEmployment(null)
    setCompany(null)
    setWorkStyles(new Set())
    setLocationFilter(null)
    setMinSalaryK(0)
    setDatePosted(null)
  }

  const toggleWorkStyle = (mode: WorkMode) => {
    setWorkStyles((prev) => {
      const next = new Set(prev)
      if (next.has(mode)) next.delete(mode)
      else next.add(mode)
      return next
    })
  }

  const handleTrack = async (job: JobListing) => {
    setTrackStates((prev) => ({ ...prev, [job.id]: 'saving' }))
    try {
      await jobsService.trackApplication({
        job_title: job.title,
        company: job.company,
        location: job.location,
        salary_range: job.salaryRange,
        job_url: job.applyUrl,
        job_description: job.description ?? undefined,
        status: 'saved',
      })
      setTrackStates((prev) => ({ ...prev, [job.id]: 'saved' }))
      toast.success('Added to your Application Pipeline.')
    } catch (err) {
      setTrackStates((prev) => ({ ...prev, [job.id]: 'failed' }))
      toast.error(errorMessage(err, 'Could not save this application.'))
    }
  }

  const handleApply = (job: JobListing) => {
    window.open(job.applyUrl, '_blank', 'noopener,noreferrer')
    setAppliedIds((prev) => new Set(prev).add(job.id))
  }

  const handleTailorResume = async (job: JobListing) => {
    try {
      const onFile = await resumeService.getResumeOnFile()
      if (!onFile.has_resume || !onFile.analysis_id) {
        toast.error('Analyze a resume first to tailor it for a job.')
        navigate('/resume/upload')
        return
      }
      navigate(`/resume/tailor?jobId=${Number(job.id)}&analysisId=${onFile.analysis_id}`, {
        state: { jobTitle: job.title, company: job.company, location: job.location, workMode: job.workMode },
      })
    } catch {
      toast.error('Could not check your resume status.')
    }
  }

  return (
    <div className="grid gap-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div>
          <h2 className="font-heading text-2xl font-bold text-foreground">Find your next opportunity</h2>
          <p className="mt-1 text-[10px] text-muted-foreground">
            AI-ranked roles based on your experience, preferences, and career goals.
          </p>
        </div>
        <div className="flex h-[43px] w-full items-center gap-2 rounded-md border border-border bg-card px-3 text-muted-foreground sm:w-[410px]">
          <Search size={17} className="shrink-0" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search roles, companies, or skills"
            aria-label="Search jobs"
            className="h-auto border-0 bg-transparent p-0 text-xs shadow-none focus-visible:ring-0"
          />
        </div>
      </div>

      <div className={cn('grid items-start gap-[14px]', filtersOpen ? 'lg:grid-cols-[232px_1fr]' : 'grid-cols-1')}>
        {filtersOpen && (
          <Card className="sticky top-[92px] p-[17px]">
            <div className="flex items-center justify-between pb-3">
              <h3 className="font-heading text-sm font-bold text-foreground">Filters</h3>
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs font-bold text-primary hover:underline"
              >
                Clear all
              </button>
            </div>

            <FilterSection label="Role">
              <Select value={roleOptions.includes(query) ? query : 'any'} onValueChange={(v) => setQuery(v === 'any' ? '' : v)}>
                <SelectTrigger className="h-9 text-[11px]">
                  <SelectValue placeholder="Any role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any role</SelectItem>
                  {roleOptions.map((role) => (
                    <SelectItem key={role} value={role}>
                      {role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterSection>

            <FilterSection label="Location">
              <Select value={locationFilter ?? 'any'} onValueChange={(v) => setLocationFilter(v === 'any' ? null : v)}>
                <SelectTrigger className="h-9 text-[11px]">
                  <SelectValue placeholder="Any location" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any location</SelectItem>
                  {locationOptions.map((location) => (
                    <SelectItem key={location} value={location}>
                      {location}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterSection>

            <FilterSection label="Work style" chevron>
              <div className="grid gap-[9px]">
                {WORK_MODES.map((mode) => (
                  <FilterCheckbox key={mode} label={mode} checked={workStyles.has(mode)} onChange={() => toggleWorkStyle(mode)} />
                ))}
              </div>
            </FilterSection>

            <FilterSection label="Minimum salary">
              <div className="flex items-baseline justify-between">
                <strong className="font-heading text-[13px] font-extrabold text-primary">
                  {minSalaryK > 0 ? `$${minSalaryK}k+` : 'Any'}
                </strong>
                <span className="text-[8px] text-muted-foreground">USD / year</span>
              </div>
              <input
                type="range"
                min={0}
                max={300}
                step={10}
                value={minSalaryK}
                onChange={(e) => setMinSalaryK(Number(e.target.value))}
                className="w-full accent-primary"
                aria-label="Minimum salary in thousands"
              />
            </FilterSection>

            <FilterSection label="Experience" chevron>
              <div className="grid gap-[9px]">
                {EXPERIENCE_OPTIONS.map((opt) => (
                  <FilterCheckbox
                    key={opt.value}
                    label={opt.label}
                    checked={experience === opt.value}
                    count={feed?.filterCounts?.experience?.[opt.value] ?? 0}
                    onChange={() => setExperience(experience === opt.value ? null : opt.value)}
                  />
                ))}
              </div>
            </FilterSection>

            <FilterSection label="Date posted" chevron>
              <div className="grid gap-[9px]">
                {DATE_POSTED_OPTIONS.map((opt) => (
                  <FilterCheckbox
                    key={opt.value}
                    label={opt.label}
                    checked={datePosted === opt.value}
                    onChange={() => setDatePosted(datePosted === opt.value ? null : opt.value)}
                  />
                ))}
              </div>
            </FilterSection>

            <FilterSection label="Sponsorship" chevron>
              <div className="grid gap-[9px]">
                {H1B_OPTIONS.map((opt) => (
                  <FilterCheckbox
                    key={opt.value}
                    label={opt.label}
                    title={opt.hint}
                    checked={h1b === opt.value}
                    count={feed?.filterCounts?.h1b?.[opt.value] ?? 0}
                    onChange={() => setH1b(h1b === opt.value ? null : opt.value)}
                  />
                ))}
              </div>
              {feed?.filterCounts && feed.filterCounts.unenriched > 0 && (
                <p className="text-[8px] text-muted-foreground">
                  {feed.filterCounts.unenriched} listing{feed.filterCounts.unenriched === 1 ? '' : 's'} not yet classified
                </p>
              )}
            </FilterSection>

            <FilterSection label="Employment type" chevron>
              <div className="grid gap-[9px]">
                {EMPLOYMENT_OPTIONS.map((opt) => (
                  <FilterCheckbox
                    key={opt.value}
                    label={opt.label}
                    checked={employment === opt.value}
                    count={feed?.filterCounts?.employment?.[opt.value] ?? 0}
                    onChange={() => setEmployment(employment === opt.value ? null : opt.value)}
                  />
                ))}
              </div>
            </FilterSection>

            {employerChips.length > 0 && (
              <FilterSection label="Employer" chevron>
                <div className="grid gap-[9px]">
                  {employerChips.map(([label, count]) => (
                    <FilterCheckbox
                      key={label}
                      label={label}
                      checked={company === label}
                      count={count}
                      onChange={() => setCompany(company === label ? null : label)}
                    />
                  ))}
                </div>
              </FilterSection>
            )}
          </Card>
        )}

        <section className="min-w-0">
          <div className="mb-2.5 flex min-h-[41px] flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setFiltersOpen((v) => !v)}>
                <SlidersHorizontal size={14} /> {filtersOpen ? 'Hide filters' : 'Show filters'}
              </Button>
              <span className="text-[10px] text-muted-foreground">
                <strong className="text-foreground">{filteredJobs.length}</strong> roles matched to you
              </span>
              {anyFilterActive && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-[10px] font-medium text-muted-foreground hover:text-foreground"
                >
                  Clear filters
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {feed?.lastUpdated && (
                <span className="inline-flex items-center gap-1.5 text-[9px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  Updated {timeLabel(feed.lastUpdated)}
                </span>
              )}
              <Button variant="ghost" size="sm" className="gap-1.5 text-[10px]" onClick={() => setRetryTick((n) => n + 1)} disabled={loading}>
                <RefreshCcw className={cn('h-3 w-3', loading && 'animate-spin')} />
                Refresh
              </Button>
              <label className="flex items-center gap-[7px] text-[10px] text-muted-foreground">
                Sort by
                <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                  <SelectTrigger className="h-[34px] w-[150px] text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="best">Best match</SelectItem>
                    <SelectItem value="newest">Newest</SelectItem>
                    <SelectItem value="salary">Salary: high to low</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>
          </div>

          {feed?.refreshing && searchTerm && (
            <div className="mb-2.5 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Searching for &ldquo;{searchTerm}&rdquo; — showing other openings until fresh results are ready.
            </div>
          )}

          {loading && !feed ? (
            <div className="grid gap-2.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <JobCardSkeleton key={i} />
              ))}
            </div>
          ) : visibleJobs.length === 0 ? (
            <Card>
              <div className="flex flex-col items-center gap-2 p-12 text-center">
                <Briefcase className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-semibold text-foreground">No jobs match your filters</p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  {failed
                    ? "Couldn't reach the job feed. Check your connection and try again."
                    : searchTerm
                      ? 'Nothing came back for that search. Try a broader role title or clear a filter.'
                      : 'No listings are cached yet for this view. Try adjusting your filters.'}
                </p>
                {(failed || anyFilterActive) && (
                  <div className="mt-2 flex items-center gap-2">
                    {failed && (
                      <Button variant="outline" size="sm" onClick={() => setRetryTick((n) => n + 1)}>
                        Try again
                      </Button>
                    )}
                    {anyFilterActive && (
                      <Button variant="ghost" size="sm" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </Card>
          ) : (
            <>
              <div className="grid gap-2.5">
                {visibleJobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    trackState={trackStates[job.id] ?? 'idle'}
                    applied={appliedIds.has(job.id)}
                    onOpen={setSelectedJob}
                    onTrack={handleTrack}
                    onApply={handleApply}
                  />
                ))}
              </div>
              {hasMore && (
                <div className="flex justify-center pt-3">
                  <Button variant="outline" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
                    Load more openings
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <Sheet open={!!selectedJob} onOpenChange={(open) => !open && setSelectedJob(null)}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[520px]">
          {selectedJob && (
            <>
              <div className="flex min-h-[89px] items-center gap-[11px] border-b border-border px-[21px] py-[18px]">
                <CompanyMark company={selectedJob.company} logoUrl={selectedJob.companyLogo} />
                <div className="min-w-0">
                  <SheetTitle className="truncate font-heading text-base font-bold text-foreground">
                    {selectedJob.title}
                  </SheetTitle>
                  <SheetDescription className="mt-[3px] truncate text-[9px]">
                    {selectedJob.company} · {selectedJob.location}
                  </SheetDescription>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-[21px] pb-[26px]">
                {selectedJob.match ? (
                  <div className="flex items-center gap-[15px] border-b border-border py-[19px]">
                    <ScoreRing score={selectedJob.match.overallMatch ?? 0} size="md" variant="ats" showPercentageSign={false} />
                    <div>
                      <AiBadge label="AI MATCH" />
                      <h3 className="mt-1.5 font-heading text-sm font-bold text-foreground">
                        {matchHeadline(selectedJob.match.band)}
                      </h3>
                      <p className="mt-1 text-[9px] text-muted-foreground">{selectedJob.match.explanation}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 border-b border-border py-[19px]">
                    <div className="rounded-lg bg-secondary p-2.5 text-primary">
                      <Sparkles size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold text-foreground">No match score yet</p>
                      <p className="mt-0.5 text-[9px] text-muted-foreground">
                        Analyze a resume to see how well you match this role.
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => navigate('/resume/upload')}>
                      Analyze resume
                    </Button>
                  </div>
                )}

                <section className="border-b border-border py-[18px]">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-heading text-[12px] font-bold text-foreground">About the role</h3>
                    {selectedJob.description && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(selectedJob.description ?? '')
                            toast.success('Job description copied to clipboard.')
                          } catch {
                            toast.error('Could not copy automatically. Select the text and copy manually.')
                          }
                        }}
                        className="flex shrink-0 items-center gap-1 text-[9px] font-bold text-primary hover:underline"
                      >
                        <Copy size={11} /> Copy
                      </button>
                    )}
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                    {selectedJob.description
                      ? descExpanded || selectedJob.description.length <= DESCRIPTION_CLAMP_CHARS
                        ? selectedJob.description
                        : `${selectedJob.description.slice(0, DESCRIPTION_CLAMP_CHARS)}…`
                      : 'No description was provided for this listing.'}
                  </p>
                  {selectedJob.description && selectedJob.description.length > DESCRIPTION_CLAMP_CHARS && (
                    <button
                      type="button"
                      onClick={() => setDescExpanded((v) => !v)}
                      className="mt-1 text-[10px] font-bold text-primary hover:underline"
                    >
                      {descExpanded ? 'Show less' : 'Show more'}
                    </button>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-muted/60 p-2.5">
                      <small className="text-[7px] font-bold uppercase tracking-wide text-muted-foreground">Salary</small>
                      <strong className="mt-0.5 block text-[10px] font-bold text-foreground">{selectedJob.salaryRange}</strong>
                    </div>
                    <div className="rounded-lg bg-muted/60 p-2.5">
                      <small className="text-[7px] font-bold uppercase tracking-wide text-muted-foreground">Posted</small>
                      <strong className="mt-0.5 block text-[10px] font-bold text-foreground">
                        {relativeDayLabel(selectedJob.postedDaysAgo)}
                      </strong>
                    </div>
                  </div>
                </section>

                {selectedJob.match && (selectedJob.match.resumeMatch || selectedJob.match.skillsMatch) && (
                  <section className="border-b border-border py-[18px]">
                    <div className="flex items-center justify-between">
                      <h3 className="font-heading text-[12px] font-bold text-foreground">Why you match</h3>
                      <AiBadge />
                    </div>
                    <div className="mt-3 grid gap-[13px]">
                      {(
                        [
                          { label: 'Resume Match', detail: selectedJob.match.resumeMatch as { score: number } | null },
                          { label: 'Skills Match', detail: selectedJob.match.skillsMatch as { score: number } | null },
                        ]
                      )
                        .filter(
                          (row): row is { label: string; detail: { score: number } } => Boolean(row.detail)
                        )
                        .map(({ label, detail }) => {
                          const tone = toneClasses(detail.score)
                          return (
                            <div key={label}>
                              <div className="flex justify-between text-[10px]">
                                <span className="text-muted-foreground">{label}</span>
                                <strong className={tone.text}>{Math.round(detail.score)}%</strong>
                              </div>
                              <div className="mt-1 h-[5px] rounded-full bg-muted">
                                <span
                                  className={cn('block h-full rounded-full', tone.bar)}
                                  style={{ width: `${Math.max(0, Math.min(100, detail.score))}%` }}
                                />
                              </div>
                            </div>
                          )
                        })}
                    </div>
                  </section>
                )}

                {selectedJob.match?.skillsMatch && selectedJob.match.skillsMatch.missingSkills.length > 0 && (
                  <section className="border-b border-border py-[18px]">
                    <h3 className="font-heading text-[12px] font-bold text-foreground">Missing skills</h3>
                    <p className="mt-1 text-[9px] text-muted-foreground">
                      Address these gaps before applying to improve your positioning.
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {selectedJob.match.skillsMatch.missingSkills.map((skill) => (
                        <span
                          key={skill}
                          className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning-tint px-2 py-1 text-[8px] font-bold text-warning"
                        >
                          + {skill}
                        </span>
                      ))}
                    </div>
                  </section>
                )}

                {selectedJob.skills.length > 0 && (
                  <section className="py-[18px]">
                    <h3 className="font-heading text-[12px] font-bold text-foreground">Skills in this role</h3>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {selectedJob.skills.map((skill) => (
                        <span
                          key={skill}
                          className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success-tint px-2 py-1 text-[8px] font-bold text-success"
                        >
                          <Check size={10} /> {skill}
                        </span>
                      ))}
                    </div>
                  </section>
                )}
              </div>

              <div className="flex justify-end gap-2 border-t border-border bg-card px-[21px] py-[14px]">
                <Button
                  variant="outline"
                  disabled={trackStates[selectedJob.id] === 'saving' || trackStates[selectedJob.id] === 'saved'}
                  onClick={() => handleTrack(selectedJob)}
                  className="gap-1.5"
                >
                  {trackStates[selectedJob.id] === 'saving' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Bookmark className="h-4 w-4" fill={trackStates[selectedJob.id] === 'saved' ? 'currentColor' : 'none'} />
                  )}
                  {trackStates[selectedJob.id] === 'saved' ? 'Saved' : 'Save'}
                </Button>
                <Button onClick={() => handleTailorResume(selectedJob)} className="gap-1.5">
                  <Wand2 size={15} /> Tailor resume for this job <Sparkles size={15} />
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
