'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Briefcase, Building2, Clock, ExternalLink, MapPin, Search, Sparkles } from 'lucide-react'
import { getJobs, type JobFeed, type WorkMode } from '../../../lib/jobsData'
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

export default function JobsPage() {
  const [feed, setFeed] = useState<JobFeed | null>(null)
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<ModeFilter>('All')

  useEffect(() => {
    getJobs().then(setFeed)
  }, [])

  const filtered = useMemo(() => {
    if (!feed) return []
    const q = query.trim().toLowerCase()
    return feed.jobs.filter((job) => {
      if (mode !== 'All' && job.workMode !== mode) return false
      if (!q) return true
      const haystack = `${job.title} ${job.company} ${job.location} ${job.skills.join(' ')}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [feed, query, mode])

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
          {feed && (
            <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-faint)]">
              <Clock className="w-3 h-3" />
              Refreshed daily · last updated {refreshLabel(feed.lastUpdated)}
            </span>
          )}
        </div>
      </motion.div>

      {/* Sample-data notice until the live feed ships */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="flex items-center gap-2 rounded-xl border border-[var(--color-accent)]/20 bg-[var(--color-accent)]/5 px-4 py-2.5 text-xs text-[var(--color-ink-dim)]"
      >
        <Sparkles className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
        Sample listings shown while the live job feed is being built — the layout, search, and filters are the real thing.
      </motion.div>

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
      {!feed ? (
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
            Try a different search term, or clear the work-mode filter.
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
              className="card-hover p-5 flex flex-col gap-4"
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
                <a
                  href={job.applyUrl}
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
    </div>
  )
}
