import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowUpRight,
  Bookmark,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  Clock3,
  FileSearch,
  MapPin,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { jobsService } from '@/services/jobsService'
import { HttpError } from '@/lib/http'
import type { JobDetails } from '@/types/jobs'

function postedLabel(job: JobDetails): string {
  if (job.postedAt) return new Date(job.postedAt).toLocaleDateString()
  if (job.dateSource === 'first_seen') {
    return job.postedDaysAgo === 0 ? 'First seen today' : `First seen ${job.postedDaysAgo} days ago`
  }
  return job.postedDaysAgo === 0 ? 'Date not supplied' : `${job.postedDaysAgo} days ago`
}

function CompanyMark({ job }: { job: JobDetails }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-card text-lg font-bold text-muted-foreground">
      {job.company.trim().slice(0, 1).toUpperCase() || '?'}
      {job.companyLogo && !failed && (
        <img
          src={job.companyLogo}
          alt=""
          aria-hidden="true"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full bg-card object-contain p-2"
        />
      )}
    </div>
  )
}

function Fact({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="flex gap-3 border-b border-border py-3 last:border-0">
      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 break-words text-sm font-medium text-foreground">{value}</dd>
      </div>
    </div>
  )
}

export function JobDetailsPage() {
  const { jobId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [job, setJob] = useState<JobDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [isSaved, setIsSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setJob(null)
    jobsService.getJob(jobId)
      .then((result) => {
        if (!cancelled) setJob(result)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof HttpError && err.response.status === 404
          ? 'This listing is no longer available.'
          : err instanceof Error ? err.message : 'Could not load this job.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [jobId])

  const returnTo = searchParams.get('returnTo')
  const backPath = returnTo?.startsWith('/jobs') ? returnTo : '/jobs'
  const workflowPath = (mode: 'analyze' | 'tailor') => {
    const params = new URLSearchParams({ jobId, returnTo: `${location.pathname}${location.search}` })
    params.set('mode', mode)
    navigate(`/resume/match?${params.toString()}`)
  }

  const saveJob = async () => {
    if (!job || saving || isSaved) return
    setSaving(true)
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
      setIsSaved(true)
      toast.success('Saved to your application pipeline.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save this job.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto grid max-w-6xl gap-5" aria-label="Loading job details" aria-busy="true">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-52 w-full" />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <Skeleton className="h-[600px] w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    )
  }

  if (!job) {
    return (
      <Card className="mx-auto grid max-w-xl justify-items-center gap-3 p-10 text-center">
        <BriefcaseBusiness className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <h1 className="font-heading text-xl font-bold text-foreground">Job details unavailable</h1>
        <p className="text-sm text-muted-foreground">{error || 'This job could not be found.'}</p>
        <Button variant="outline" onClick={() => navigate(backPath)}><ArrowLeft className="mr-2 h-4 w-4" />Back to search</Button>
      </Card>
    )
  }

  const closed = job.status !== 'open'
  const applyAvailable = !closed && Boolean(job.applyUrl)
  const titleFacts = [job.workMode, job.employmentType?.replace('_', ' '), job.experienceLevel].filter(Boolean)

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-5 pb-8">
      <button
        type="button"
        onClick={() => navigate(backPath)}
        className="flex w-fit items-center gap-2 rounded-sm text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" /> Back to search results
      </button>

      <section className="grid gap-5 border-b border-border pb-6 md:grid-cols-[auto_minmax(0,1fr)] md:items-start">
        <CompanyMark job={job} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={closed ? 'outline' : 'success'}>{closed ? 'Closed listing' : 'Open listing'}</Badge>
            {job.source && <Badge variant="outline">{job.source}</Badge>}
          </div>
          <h1 className="mt-3 break-words font-heading text-2xl font-bold leading-tight text-foreground sm:text-3xl">{job.title}</h1>
          <p className="mt-1 text-base font-medium text-muted-foreground">{job.company}</p>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2"><MapPin className="h-4 w-4" />{job.location || 'Location not supplied'}</span>
            {job.salaryRange && job.salaryRange !== 'Not disclosed' && <span>{job.salaryRange}</span>}
            <span className="inline-flex items-center gap-2"><Clock3 className="h-4 w-4" />{postedLabel(job)}</span>
            {titleFacts.map((fact) => <span key={fact} className="capitalize">{fact?.replace('_', ' ')}</span>)}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {applyAvailable ? (
              <Button asChild>
                <a href={job.applyUrl!} target="_blank" rel="noopener noreferrer">
                  Apply Now <ArrowUpRight className="ml-2 h-4 w-4" />
                  <span className="sr-only">Opens the employer site in a new tab</span>
                </a>
              </Button>
            ) : (
              <Button disabled title={closed ? 'This listing is closed.' : 'No application link was supplied by the source.'}>Apply unavailable</Button>
            )}
            <Button variant="outline" onClick={saveJob} disabled={saving || isSaved}>
              {isSaved ? <Check className="mr-2 h-4 w-4" /> : <Bookmark className="mr-2 h-4 w-4" />}
              {saving ? 'Saving…' : isSaved ? 'Saved' : 'Save job'}
            </Button>
            <Button variant="outline" onClick={() => workflowPath('analyze')}>
              <FileSearch className="mr-2 h-4 w-4" />Analyze resume match
            </Button>
            <Button variant="outline" onClick={() => workflowPath('tailor')}>
              <Sparkles className="mr-2 h-4 w-4" />Tailor resume
            </Button>
          </div>
          {closed && <p className="mt-3 text-sm text-muted-foreground">This source has marked the listing closed. No application will be submitted from HireLoom.</p>}
        </div>
      </section>

      <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_280px]">
        <article className="min-w-0">
          <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading text-xl font-bold text-foreground">Job description</h2>
            {job.postedAt && <span className="inline-flex items-center gap-2 text-sm text-muted-foreground"><CalendarDays className="h-4 w-4" />Posted {new Date(job.postedAt).toLocaleDateString()}</span>}
          </header>
          {job.description ? (
            <div className="whitespace-pre-wrap break-words text-[15px] leading-7 text-foreground/90">{job.description}</div>
          ) : (
            <div className="border-l-2 border-muted-foreground/40 py-2 pl-4 text-sm text-muted-foreground">
              The source did not supply a job description.
            </div>
          )}
        </article>

        <aside className="grid gap-4 lg:sticky lg:top-24">
          <section className="border-t-2 border-primary pt-3">
            <h2 className="font-heading text-base font-bold text-foreground">Job facts</h2>
            <dl className="mt-2">
              <Fact icon={BriefcaseBusiness} label="Employment" value={job.employmentType?.replace('_', ' ')} />
              <Fact icon={MapPin} label="Location" value={[job.location, job.workMode].filter(Boolean).join(' · ')} />
              <Fact icon={Clock3} label="Experience" value={job.experienceLevel} />
              <Fact icon={CalendarDays} label="Posted" value={postedLabel(job)} />
              <Fact icon={ShieldCheck} label="Work authorization" value={job.h1bSponsorship === 'explicitly_sponsored' ? 'Posting states sponsorship is available' : job.h1bSponsorship === 'no_sponsorship' ? 'Posting states sponsorship is unavailable' : undefined} />
            </dl>
            {job.h1bEvidence && <blockquote className="mt-3 border-l-2 border-border pl-3 text-xs leading-5 text-muted-foreground">“{job.h1bEvidence}”</blockquote>}
            {job.source && <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">Source: {job.source}{job.externalId ? ` · Reference ${job.externalId}` : ''}</p>}
          </section>
          <section className="border-t border-border pt-3">
            <h2 className="font-heading text-base font-bold text-foreground">Resume match</h2>
            {job.match?.overallMatch != null ? (
              <p className="mt-2 text-sm text-muted-foreground">Portal estimate: <strong className="text-foreground">{Math.round(job.match.overallMatch)}%</strong>. Analyze a selected resume for a job-specific score.</p>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">No job-specific resume analysis has been run for this listing.</p>
            )}
            <Button variant="outline" className="mt-3 w-full" onClick={() => workflowPath('analyze')}>Analyze resume match</Button>
          </section>
        </aside>
      </div>
    </main>
  )
}