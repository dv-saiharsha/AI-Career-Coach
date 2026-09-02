'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  BarChart3,
  Briefcase,
  FileSearch,
  FileText,
  KanbanSquare,
  LayoutDashboard,
  MessageSquareCode,
  Scale,
  Search,
  Settings,
  TrendingUp,
  User,
  X,
} from 'lucide-react'

import { getApplicationPipeline, getJobs, type JobListing } from '@/lib/apiClient'
import { cn } from '@/lib/utils'

/**
 * Search, in the header, beside its own icon.
 *
 * It replaces a centred modal that listed the same nine page names no matter
 * what you typed. Two things were wrong with that: it covered the page you
 * were searching from, and it could not find anything that was not a route —
 * a job title, a company you had applied to, the things people actually look
 * for in a product like this.
 *
 * The icon expands into an input in place. Results appear directly under it,
 * anchored to the control rather than floating in the middle of the screen,
 * so the page stays visible and the search reads as part of the header
 * instead of an interruption.
 *
 * WHAT IT SEARCHES, AND WHEN
 *
 * Pages filter locally on every keystroke — the list is nine items, there is
 * nothing to wait for.
 *
 * Jobs and applications are fetched, so they are debounced. 220ms is chosen
 * against typing speed rather than pulled from the air: a fluent typist is
 * around 60-80ms between keys, so 220 fires once at the end of a word rather
 * than once per letter, and still feels immediate. Every fetch is also
 * sequence-guarded — a slow response for "eng" must never overwrite a fast
 * one for "engineer", which is the classic way a search box shows the wrong
 * results for the right query.
 */

const PAGES = [
  { label: 'Overview', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Resume Analyzer', href: '/resume', icon: FileSearch },
  { label: 'Interview Coach', href: '/interview', icon: MessageSquareCode },
  { label: 'Jobs', href: '/jobs', icon: Briefcase },
  { label: 'Applications', href: '/applications', icon: KanbanSquare },
  { label: 'Cover Letter', href: '/cover-letter', icon: FileText },
  { label: 'Offers', href: '/offers', icon: Scale },
  { label: 'Analytics', href: '/analytics', icon: BarChart3 },
  { label: 'Reports', href: '/reports', icon: TrendingUp },
  { label: 'Profile', href: '/profile', icon: User },
  { label: 'Settings', href: '/settings', icon: Settings },
]

const DEBOUNCE_MS = 220
/** Below this a query matches most of the corpus and the fetch is wasted. */
const MIN_REMOTE_CHARS = 2

interface RemoteResults {
  /** The query these results are for. Rendering compares it to the live
      query, so stale results are never shown and nothing has to be cleared
      synchronously in an effect to keep them honest. */
  term: string
  jobs: JobListing[]
  applications: { id: number; title: string; company: string }[]
}

export default function HeaderSearchPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [query, setQuery] = React.useState('')
  const [remote, setRemote] = React.useState<RemoteResults>({
    term: '',
    jobs: [],
    applications: [],
  })
  const inputRef = React.useRef<HTMLInputElement>(null)
  const rootRef = React.useRef<HTMLDivElement>(null)

  const pages = React.useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return []
    return PAGES.filter((page) => page.label.toLowerCase().includes(term)).slice(0, 5)
  }, [query])

  /* Focus on mount — this component only exists once search is open, so
     mounting is the moment to take the caret. Escape closes; the ⌘K that
     opened it lives in the trigger, which is what exists before this does. */
  React.useEffect(() => {
    inputRef.current?.focus()
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /* Close on a click outside. Pointerdown rather than click so the panel is
     gone before the click lands on whatever is underneath. */
  React.useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [onClose])

  /* The fetched half. */
  const sequence = React.useRef(0)
  React.useEffect(() => {
    const term = query.trim()
    if (term.length < MIN_REMOTE_CHARS) return

    const ticket = ++sequence.current
    const timer = window.setTimeout(async () => {
      try {
        const [feed, pipeline] = await Promise.all([
          getJobs(term).catch(() => null),
          getApplicationPipeline().catch(() => null),
        ])

        /* A later query has already been issued — drop this one rather than
           letting a slow "eng" overwrite a fast "engineer". */
        if (ticket !== sequence.current) return

        const lower = term.toLowerCase()
        const applications = (pipeline ? Object.values(pipeline).flat() : [])
          .filter(
            (row): row is { id: number; job_title: string; company: string } =>
              Boolean(row && typeof row === 'object' && 'job_title' in row),
          )
          .filter(
            (row) =>
              row.job_title.toLowerCase().includes(lower) ||
              row.company.toLowerCase().includes(lower),
          )
          .slice(0, 4)
          .map((row) => ({ id: row.id, title: row.job_title, company: row.company }))

        setRemote({ term, jobs: (feed?.jobs ?? []).slice(0, 5), applications })
      } catch {
        /* Stamped with the term either way, so a failed lookup settles as
           "nothing found" rather than spinning forever. */
        if (ticket === sequence.current) setRemote({ term, jobs: [], applications: [] })
      }
    }, DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [query])

  function go(href: string) {
    onClose()
    router.push(href)
  }

  const trimmed = query.trim()
  /* Results belong to this query, or they are not shown. */
  const fresh = remote.term === trimmed ? remote : { term: trimmed, jobs: [], applications: [] }
  const loading = trimmed.length >= MIN_REMOTE_CHARS && remote.term !== trimmed
  const hasResults = pages.length > 0 || fresh.jobs.length > 0 || fresh.applications.length > 0

  return (
    <div ref={rootRef} className="relative">
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg bg-canvas px-3',
          'h-9 w-[min(62vw,22rem)] field-ring',
        )}
      >
        <Search className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Jobs, applications, pages…"
          aria-label="Search"
          className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-faint"
        />
        <button
          type="button"
          onClick={() => {
            onClose()
          }}
          aria-label="Close search"
          className="shrink-0 rounded p-0.5 text-ink-faint transition-colors hover:text-ink"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {query.trim().length > 0 && (
        <div
          className="absolute right-0 top-11 z-50 w-[min(84vw,26rem)] overflow-hidden rounded-xl bg-canvas-raise p-1.5 elev-lg"
          role="listbox"
          aria-label="Search results"
        >
          {!hasResults && (
            <p className="px-3 py-6 text-center text-[13px] text-ink-faint">
              {loading ? 'Searching…' : `Nothing matching “${query.trim()}”.`}
            </p>
          )}

          {pages.length > 0 && (
            <Group label="Pages">
              {pages.map((page) => (
                <Row key={page.href} onSelect={() => go(page.href)}>
                  <page.icon className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                  <span className="truncate">{page.label}</span>
                </Row>
              ))}
            </Group>
          )}

          {fresh.jobs.length > 0 && (
            <Group label="Jobs">
              {fresh.jobs.map((job) => (
                <Row key={job.id} onSelect={() => go('/jobs')}>
                  <Briefcase className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{job.title}</span>
                  <span className="shrink-0 text-[11px] text-ink-faint">{job.company}</span>
                </Row>
              ))}
            </Group>
          )}

          {fresh.applications.length > 0 && (
            <Group label="Your applications">
              {fresh.applications.map((row) => (
                <Row key={row.id} onSelect={() => go('/applications')}>
                  <KanbanSquare className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{row.title}</span>
                  <span className="shrink-0 text-[11px] text-ink-faint">{row.company}</span>
                </Row>
              ))}
            </Group>
          )}
        </div>
      )}
    </div>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-1">
      <p className="px-3 pb-1 pt-1.5 text-[10px] uppercase tracking-[0.12em] text-ink-faint">
        {label}
      </p>
      {children}
    </div>
  )
}

function Row({ onSelect, children }: { onSelect: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={false}
      onClick={onSelect}
      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] text-ink transition-colors hover:bg-canvas-hover"
    >
      {children}
    </button>
  )
}
