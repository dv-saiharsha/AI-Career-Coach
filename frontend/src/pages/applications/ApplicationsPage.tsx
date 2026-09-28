import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Briefcase,
  CalendarDays,
  Check,
  ChevronDown,
  Clock,
  ExternalLink,
  FileText,
  Filter,
  Inbox,
  LayoutGrid,
  List,
  Loader2,
  Mail,
  MessageSquareText,
  Plus,
  Search,
  Sparkles,
  Target,
  Trash2,
  User,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { HttpError } from '@/lib/http'
import { applicationsService, stageForColumn } from '@/services/applicationsService'
import {
  type ActivityItem,
  type ApplicationDetail,
  type ApplicationRecord,
  type ApplicationStatus,
  type PipelineResponse,
  STAGE_COLUMNS,
  STAGE_LABELS,
} from '@/types/applications'

type ViewMode = 'board' | 'table'

const STATUS_TO_COLUMN: Record<string, string> = Object.fromEntries(
  STAGE_COLUMNS.flatMap((column) => column.members.map((status) => [status, column.id]))
)

// Figma's own mock only colors two states (Offer -> success, Interviewing ->
// indigo) and leaves everything else neutral — matched exactly rather than
// inventing a richer palette the source doesn't have.
const COLUMN_BADGE_VARIANT: Record<string, 'success' | 'subtle' | 'outline'> = {
  offer: 'success',
  interviewing: 'subtle',
}

const COLUMN_DOT_CLASS: Record<string, string> = {
  saved: 'bg-muted-foreground/40',
  applied: 'bg-primary/60',
  interviewing: 'bg-coral',
  offer: 'bg-success',
  closed: 'bg-destructive',
}

function badgeVariantForColumn(columnId: string): 'success' | 'subtle' | 'outline' {
  return COLUMN_BADGE_VARIANT[columnId] ?? 'outline'
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const days = Math.floor((Date.now() - then) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

function initials(name: string): string {
  return (name || '?').trim().charAt(0).toUpperCase()
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof HttpError ? err.message : fallback
}

function orNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/** Every manual stage, grouped under the same column headings the board
 *  itself uses. 'viewed' is deliberately excluded — it's an automatic
 *  signal, never a manual target (see application.py's model comment on
 *  _SILENT_STATUSES / APPLICATION_STATUSES). */
function StageSelect({
  value,
  onChange,
  disabled,
  triggerClassName,
  children,
}: {
  value: ApplicationStatus
  onChange: (status: ApplicationStatus) => void
  disabled?: boolean
  triggerClassName?: string
  children: React.ReactNode
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as ApplicationStatus)} disabled={disabled}>
      <SelectTrigger className={triggerClassName}>{children}</SelectTrigger>
      <SelectContent>
        {STAGE_COLUMNS.map((column) => (
          <SelectGroup key={column.id}>
            <SelectLabel>{column.label}</SelectLabel>
            {column.members.map((stage) => (
              <SelectItem key={stage} value={stage}>
                {STAGE_LABELS[stage]}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}

interface ApplicationCardProps {
  application: ApplicationRecord
  busy: boolean
  onOpen: () => void
  onDragStart: (event: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
}

function ApplicationCard({ application, busy, onOpen, onDragStart, onDragEnd }: ApplicationCardProps) {
  const exactStage = STAGE_LABELS[application.status]
  return (
    <Card
      draggable={!busy}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className={cn(
        'cursor-grab p-3 transition-all active:cursor-grabbing hover:border-primary/40 hover:shadow-md',
        busy && 'pointer-events-none opacity-50'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground/80 font-heading text-[10px] font-bold text-white">
          {initials(application.company)}
        </span>
        {application.match_score != null && (
          <Badge variant="subtle" className="gap-1 text-[9px]">
            <Target className="h-2.5 w-2.5" />
            {Math.round(application.match_score)}%
          </Badge>
        )}
      </div>
      <h4 className="mt-2.5 truncate font-heading text-[11px] font-bold text-foreground">{application.company}</h4>
      <p className="mt-0.5 line-clamp-2 min-h-[27px] text-[8.5px] leading-[1.45] text-muted-foreground">
        {application.job_title}
      </p>
      <div className="mt-2.5 grid gap-1.5 border-t border-border pt-2.5 text-[7.5px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <CalendarDays className="h-2.5 w-2.5" />
          {application.applied_at ? `Applied ${formatDate(application.applied_at)}` : `Added ${formatDate(application.created_at)}`}
        </span>
        <span className="truncate font-bold text-primary">{exactStage}</span>
      </div>
    </Card>
  )
}

interface CreateFormState {
  job_title: string
  company: string
  location: string
  salary_range: string
  job_url: string
  job_description: string
  notes: string
  status: ApplicationStatus
}

const EMPTY_CREATE_FORM: CreateFormState = {
  job_title: '',
  company: '',
  location: '',
  salary_range: '',
  job_url: '',
  job_description: '',
  notes: '',
  status: 'saved',
}

interface EditDraft {
  job_title: string
  company: string
  location: string
  salary_range: string
  job_url: string
  notes: string
  recruiter_name: string
  recruiter_email: string
}

function draftFromDetail(detail: ApplicationDetail): EditDraft {
  const application = detail.application
  return {
    job_title: application.job_title,
    company: application.company,
    location: application.location ?? '',
    salary_range: application.salary_range ?? '',
    job_url: application.job_url ?? '',
    notes: application.notes ?? '',
    recruiter_name: application.recruiter_name ?? '',
    recruiter_email: application.recruiter_email ?? '',
  }
}

export function ApplicationsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [pipeline, setPipeline] = useState<PipelineResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [activity, setActivity] = useState<ActivityItem[]>([])

  const [view, setView] = useState<ViewMode>('board')
  const [query, setQuery] = useState('')
  const [stageFilter, setStageFilter] = useState<Set<string>>(new Set())

  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set())
  const [draggedId, setDraggedId] = useState<number | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<ApplicationRecord | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState<CreateFormState>(EMPTY_CREATE_FORM)
  const [creating, setCreating] = useState(false)

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<ApplicationDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  const [savingDetail, setSavingDetail] = useState(false)
  const [detailStatusSaving, setDetailStatusSaving] = useState(false)

  // Deep link from History's "View" action (?open=<id>) — consumed once so
  // it doesn't reopen the drawer if the user closes it and the URL is still
  // sitting there (e.g. back/forward navigation).
  useEffect(() => {
    const openId = searchParams.get('open')
    if (!openId) return
    const parsed = Number(openId)
    if (Number.isFinite(parsed)) setSelectedId(parsed)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('open')
      return next
    }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadPipeline = useCallback(async () => {
    try {
      const data = await applicationsService.getPipeline()
      setPipeline(data)
      setLoadError(false)
    } catch (err) {
      setLoadError(true)
      toast.error(errorMessage(err, 'Could not load your application pipeline.'))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadActivity = useCallback(async () => {
    try {
      const data = await applicationsService.getActivity()
      setActivity(data)
    } catch {
      // Non-critical: the board itself doesn't depend on the activity feed.
    }
  }, [])

  useEffect(() => {
    loadPipeline()
    loadActivity()
  }, [loadPipeline, loadActivity])

  const loadDetail = useCallback((id: number) => {
    setDetailLoading(true)
    setDetailError(false)
    applicationsService
      .getDetail(id)
      .then((data) => setDetail(data))
      .catch((err) => {
        setDetailError(true)
        toast.error(errorMessage(err, 'Could not load this application.'))
      })
      .finally(() => setDetailLoading(false))
  }, [])

  useEffect(() => {
    if (selectedId == null) {
      setDetail(null)
      setEditDraft(null)
      setEditing(false)
      return
    }
    loadDetail(selectedId)
  }, [selectedId, loadDetail])

  useEffect(() => {
    setEditDraft(detail ? draftFromDetail(detail) : null)
  }, [detail])

  const columns = useMemo(() => {
    const byStage = pipeline?.pipeline ?? {}
    const q = query.trim().toLowerCase()
    return STAGE_COLUMNS.filter((column) => stageFilter.size === 0 || stageFilter.has(column.id)).map((column) => {
      const applications = column.members
        .flatMap((stage) => byStage[stage] ?? [])
        .filter((a) => !q || `${a.company} ${a.job_title}`.toLowerCase().includes(q))
        .slice()
        .sort((a, b) => (b.updated_at ? Date.parse(b.updated_at) : 0) - (a.updated_at ? Date.parse(a.updated_at) : 0))
      return { ...column, applications }
    })
  }, [pipeline, stageFilter, query])

  const total = pipeline?.total ?? 0
  const visibleTotal = columns.reduce((sum, c) => sum + c.applications.length, 0)
  const filtersActive = Boolean(query.trim()) || stageFilter.size > 0
  const isEmpty = !loading && !loadError && total === 0
  const noResults = !loading && !loadError && total > 0 && visibleTotal === 0

  const withPending = useCallback((id: number, active: boolean) => {
    setPendingIds((prev) => {
      const next = new Set(prev)
      if (active) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const findApplication = useCallback(
    (id: number): ApplicationRecord | null => {
      if (!pipeline) return null
      for (const list of Object.values(pipeline.pipeline)) {
        const found = list.find((a) => a.id === id)
        if (found) return found
      }
      return null
    },
    [pipeline]
  )

  const moveApplicationLocally = useCallback((id: number, toStatus: ApplicationStatus, patch?: ApplicationRecord) => {
    setPipeline((prev) => {
      if (!prev) return prev
      const next: Record<string, ApplicationRecord[]> = {}
      let moved: ApplicationRecord | null = null
      for (const [status, list] of Object.entries(prev.pipeline)) {
        next[status] = list.filter((a) => {
          if (a.id === id) {
            moved = a
            return false
          }
          return true
        })
      }
      if (!moved) return prev
      const updated = patch ?? { ...(moved as ApplicationRecord), status: toStatus }
      next[toStatus] = [updated, ...(next[toStatus] ?? [])]
      return { ...prev, pipeline: next }
    })
  }, [])

  const handleDrop = useCallback(
    async (columnId: string) => {
      setDragOverColumn(null)
      const id = draggedId
      setDraggedId(null)
      if (id == null) return
      const application = findApplication(id)
      if (!application) return
      const targetStatus = stageForColumn(columnId, application.status)
      if (targetStatus === application.status) return

      const snapshot = pipeline
      moveApplicationLocally(id, targetStatus)
      withPending(id, true)
      try {
        const updated = await applicationsService.updateStatus(id, targetStatus)
        moveApplicationLocally(id, targetStatus, updated)
        toast.success(`Moved ${application.job_title} to ${STAGE_LABELS[targetStatus]}.`)
        loadActivity()
        if (selectedId === id) loadDetail(id)
      } catch (err) {
        setPipeline(snapshot)
        toast.error(errorMessage(err, "Couldn't move that application — it's back where it was."))
      } finally {
        withPending(id, false)
      }
    },
    [draggedId, findApplication, pipeline, moveApplicationLocally, withPending, loadActivity, selectedId, loadDetail]
  )

  const handleDetailStatusChange = useCallback(
    async (status: ApplicationStatus) => {
      if (!detail || status === detail.application.status) return
      setDetailStatusSaving(true)
      try {
        const updated = await applicationsService.updateStatus(detail.application.id, status)
        setDetail((prev) => (prev ? { ...prev, application: updated } : prev))
        toast.success(`Moved to ${STAGE_LABELS[status]}.`)
        loadPipeline()
        loadActivity()
      } catch (err) {
        toast.error(errorMessage(err, "Couldn't move that application."))
      } finally {
        setDetailStatusSaving(false)
      }
    },
    [detail, loadPipeline, loadActivity]
  )

  const handleDeleteConfirmed = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await applicationsService.remove(deleteTarget.id)
      toast.success(`Removed ${deleteTarget.job_title} at ${deleteTarget.company}.`)
      if (selectedId === deleteTarget.id) setSelectedId(null)
      setDeleteTarget(null)
      await loadPipeline()
      loadActivity()
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't remove that application."))
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, selectedId, loadPipeline, loadActivity])

  const openCreate = (status: ApplicationStatus = 'saved') => {
    setCreateForm({ ...EMPTY_CREATE_FORM, status })
    setCreateOpen(true)
  }

  const handleCreateSubmit = useCallback(async () => {
    if (!createForm.job_title.trim() || !createForm.company.trim()) {
      toast.error('Role title and company are required.')
      return
    }
    setCreating(true)
    try {
      const created = await applicationsService.create({
        job_title: createForm.job_title.trim(),
        company: createForm.company.trim(),
        location: createForm.location.trim() || undefined,
        salary_range: createForm.salary_range.trim() || undefined,
        job_url: createForm.job_url.trim() || undefined,
        job_description: createForm.job_description.trim() || undefined,
        notes: createForm.notes.trim() || undefined,
        status: createForm.status,
      })
      toast.success(`${created.job_title} at ${created.company} added to ${STAGE_LABELS[created.status]}.`)
      setCreateOpen(false)
      setCreateForm(EMPTY_CREATE_FORM)
      await loadPipeline()
      loadActivity()
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't add that application."))
    } finally {
      setCreating(false)
    }
  }, [createForm, loadPipeline, loadActivity])

  const handleSaveDetail = useCallback(async () => {
    if (!detail || !editDraft) return
    if (!editDraft.job_title.trim() || !editDraft.company.trim()) {
      toast.error('Role title and company are required.')
      return
    }
    setSavingDetail(true)
    try {
      const updated = await applicationsService.update(detail.application.id, {
        job_title: editDraft.job_title.trim(),
        company: editDraft.company.trim(),
        location: orNull(editDraft.location),
        salary_range: orNull(editDraft.salary_range),
        job_url: orNull(editDraft.job_url),
        notes: orNull(editDraft.notes),
        recruiter_name: orNull(editDraft.recruiter_name),
        recruiter_email: orNull(editDraft.recruiter_email),
      })
      setDetail((prev) => (prev ? { ...prev, application: updated } : prev))
      toast.success('Changes saved.')
      setEditing(false)
      loadPipeline()
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't save changes."))
    } finally {
      setSavingDetail(false)
    }
  }, [detail, editDraft, loadPipeline])

  const toggleStageFilter = (columnId: string) => {
    setStageFilter((prev) => {
      const next = new Set(prev)
      if (next.has(columnId)) next.delete(columnId)
      else next.add(columnId)
      return next
    })
  }

  return (
    <div className="grid gap-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div>
          <h2 className="font-heading text-2xl font-bold text-foreground">Applications Pipeline</h2>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Keep every opportunity, conversation, and next step moving.
          </p>
        </div>
        <Button onClick={() => openCreate()} className="gap-1.5">
          <Plus size={16} /> Add application
        </Button>
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-2.5 pl-3.5">
        <div className="flex h-9 w-full items-center gap-2 rounded-md border border-border bg-card px-3 text-muted-foreground sm:w-[260px]">
          <Search size={16} className="shrink-0" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search applications"
            aria-label="Search applications"
            className="h-auto border-0 bg-transparent p-0 text-xs shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-1.5">
                <Filter size={15} /> Filters
                {stageFilter.size > 0 && (
                  <Badge variant="subtle" className="ml-0.5 px-1.5 py-0 text-[9px]">
                    {stageFilter.size}
                  </Badge>
                )}
                <ChevronDown size={13} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Show stages</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {STAGE_COLUMNS.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={stageFilter.size === 0 || stageFilter.has(column.id)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() => toggleStageFilter(column.id)}
                >
                  {column.label}
                </DropdownMenuCheckboxItem>
              ))}
              {stageFilter.size > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <button
                    type="button"
                    onClick={() => setStageFilter(new Set())}
                    className="w-full rounded-sm px-2 py-1.5 text-left text-xs font-medium text-primary hover:bg-accent"
                  >
                    Clear stage filter
                  </button>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="flex gap-[3px] rounded-lg bg-muted p-[3px]">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Board view"
              className={cn('h-[30px] w-8', view === 'board' && 'bg-card text-primary shadow-soft hover:bg-card')}
              onClick={() => setView('board')}
            >
              <LayoutGrid size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Table view"
              className={cn('h-[30px] w-8', view === 'table' && 'bg-card text-primary shadow-soft hover:bg-card')}
              onClick={() => setView('table')}
            >
              <List size={16} />
            </Button>
          </div>
        </div>
      </Card>

      {loading && (
        <div className="flex gap-2.5 overflow-x-auto pb-2">
          {STAGE_COLUMNS.map((column) => (
            <div key={column.id} className="w-[232px] shrink-0 space-y-2.5 rounded-xl bg-muted/50 p-2.5">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          ))}
        </div>
      )}

      {!loading && loadError && (
        <Card>
          <div className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-sm text-muted-foreground">
              Could not load your pipeline. Check that the API is running and try again.
            </p>
            <Button variant="outline" size="sm" onClick={loadPipeline}>
              Retry
            </Button>
          </div>
        </Card>
      )}

      {isEmpty && (
        <Card className="border-dashed">
          <div className="flex flex-col items-center gap-3 p-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary text-primary">
              <Inbox className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-bold text-foreground">No applications tracked yet</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              Start building your pipeline by browsing open roles, or add one manually if you've already applied
              somewhere.
            </p>
            <div className="mt-2 flex items-center gap-3">
              <Button asChild size="sm" className="gap-2">
                <Link to="/jobs">
                  <Search className="h-4 w-4" />
                  <span>Browse open jobs</span>
                </Link>
              </Button>
              <Button variant="outline" size="sm" onClick={() => openCreate()} className="gap-2">
                <Plus className="h-4 w-4" />
                <span>Add manually</span>
              </Button>
            </div>
          </div>
        </Card>
      )}

      {noResults && (
        <Card className="border-dashed">
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <p className="text-sm font-semibold text-foreground">No applications match your filters</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQuery('')
                setStageFilter(new Set())
              }}
            >
              Clear search and filters
            </Button>
          </div>
        </Card>
      )}

      {!loading && !loadError && !isEmpty && !noResults && view === 'board' && (
        <div className="grid grid-flow-col auto-cols-[minmax(218px,1fr)] gap-2.5 overflow-x-auto pb-3">
          {columns.map((column) => (
            <section
              key={column.id}
              onDragOver={(e) => {
                e.preventDefault()
                if (dragOverColumn !== column.id) setDragOverColumn(column.id)
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOverColumn(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                handleDrop(column.id)
              }}
              className={cn(
                'min-h-[590px] rounded-xl bg-muted/50 p-2.5 transition-colors',
                dragOverColumn === column.id && 'bg-primary/10 ring-2 ring-primary/40'
              )}
            >
              <div className="mb-1.5 flex min-h-[38px] items-center gap-1.5 px-1 pb-[7px]">
                <span className={cn('h-2 w-2 shrink-0 rounded-full', COLUMN_DOT_CLASS[column.id])} />
                <h3 className="flex-1 truncate text-[13px] font-bold text-foreground">{column.label}</h3>
                <span className="grid h-5 w-5 place-items-center rounded-md bg-card text-[10px] font-mono text-muted-foreground">
                  {column.applications.length}
                </span>
              </div>
              <div className="grid gap-2">
                {column.applications.length === 0 && (
                  <p className="px-1 text-[10px] italic text-muted-foreground">Nothing here.</p>
                )}
                {column.applications.map((application) => (
                  <ApplicationCard
                    key={application.id}
                    application={application}
                    busy={pendingIds.has(application.id)}
                    onOpen={() => setSelectedId(application.id)}
                    onDragStart={(e) => {
                      setDraggedId(application.id)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragEnd={() => {
                      setDraggedId(null)
                      setDragOverColumn(null)
                    }}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => openCreate(column.entry)}
                  className="w-full rounded-md border border-dashed border-border py-2 text-[9px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                >
                  + Add application
                </button>
              </div>
            </section>
          ))}
        </div>
      )}

      {!loading && !loadError && !isEmpty && !noResults && view === 'table' && (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-[1fr_1.5fr_.8fr_.8fr_1.2fr_.6fr] gap-2.5 border-b border-border bg-muted/40 px-4 py-2.5 text-[7px] font-extrabold uppercase tracking-wide text-muted-foreground">
            <span>Company</span>
            <span>Role</span>
            <span>Status</span>
            <span>Applied / saved</span>
            <span>Current stage</span>
            <span>Match</span>
          </div>
          {columns.flatMap((column) => column.applications).map((application) => {
            const columnId = STATUS_TO_COLUMN[application.status] ?? 'saved'
            return (
              <button
                key={application.id}
                type="button"
                onClick={() => setSelectedId(application.id)}
                className="grid w-full grid-cols-[1fr_1.5fr_.8fr_.8fr_1.2fr_.6fr] items-center gap-2.5 border-b border-border px-4 py-3 text-left text-[10px] text-muted-foreground transition-colors last:border-b-0 hover:bg-accent"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-foreground/80 text-[9px] font-bold text-white">
                    {initials(application.company)}
                  </span>
                  <strong className="truncate text-foreground">{application.company}</strong>
                </span>
                <span className="truncate">{application.job_title}</span>
                <span>
                  <Badge variant={badgeVariantForColumn(columnId)} className="text-[9px]">
                    {STAGE_COLUMNS.find((c) => c.id === columnId)?.label ?? columnId}
                  </Badge>
                </span>
                <span>{application.applied_at ? formatDate(application.applied_at) : formatDate(application.created_at)}</span>
                <span className="truncate font-medium text-foreground">{STAGE_LABELS[application.status]}</span>
                <span className="font-medium text-foreground">
                  {application.match_score != null ? `${Math.round(application.match_score)}%` : '—'}
                </span>
              </button>
            )
          })}
        </Card>
      )}

      {activity.length > 0 && (
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Recent activity
          </h2>
          <div className="mt-3 divide-y divide-border/60">
            {activity.slice(0, 8).map((item, index) => (
              <div
                key={`${item.application_id}-${item.changed_at}-${index}`}
                className="flex items-center justify-between py-2 text-xs"
              >
                <span className="max-w-[55%] truncate font-medium text-foreground">
                  {item.job_title} <span className="font-normal text-muted-foreground">· {item.company}</span>
                </span>
                <span className="text-right text-muted-foreground">
                  {item.from_status ? `${STAGE_LABELS[item.from_status]} → ` : 'Added as '}
                  {STAGE_LABELS[item.to_status]} · {formatDate(item.changed_at)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Add application modal */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) setCreateForm(EMPTY_CREATE_FORM)
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-[480px] overflow-y-auto rounded-xl p-[21px]">
          <DialogHeader className="space-y-0.5">
            <DialogTitle className="font-heading text-lg font-bold text-foreground">Add application</DialogTitle>
            <p className="text-xs text-muted-foreground">Track a new opportunity in your pipeline.</p>
          </DialogHeader>
          <div className="mt-2 grid gap-3.5">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="create-company">Company *</Label>
                <Input
                  id="create-company"
                  value={createForm.company}
                  onChange={(e) => setCreateForm((f) => ({ ...f, company: e.target.value }))}
                  placeholder="e.g. Figma"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-title">Role *</Label>
                <Input
                  id="create-title"
                  value={createForm.job_title}
                  onChange={(e) => setCreateForm((f) => ({ ...f, job_title: e.target.value }))}
                  placeholder="e.g. Senior Product Designer"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="create-location">Location</Label>
                <Input
                  id="create-location"
                  value={createForm.location}
                  onChange={(e) => setCreateForm((f) => ({ ...f, location: e.target.value }))}
                  placeholder="Remote"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-salary">Salary range</Label>
                <Input
                  id="create-salary"
                  value={createForm.salary_range}
                  onChange={(e) => setCreateForm((f) => ({ ...f, salary_range: e.target.value }))}
                  placeholder="$120k–$150k"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-url">Posting URL</Label>
              <Input
                id="create-url"
                value={createForm.job_url}
                onChange={(e) => setCreateForm((f) => ({ ...f, job_url: e.target.value }))}
                placeholder="https://…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-status">Status</Label>
              <StageSelect
                value={createForm.status}
                onChange={(status) => setCreateForm((f) => ({ ...f, status }))}
                triggerClassName="h-10 text-sm"
              >
                <span>{STAGE_LABELS[createForm.status]}</span>
              </StageSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-description">Job description</Label>
              <Textarea
                id="create-description"
                value={createForm.job_description}
                onChange={(e) => setCreateForm((f) => ({ ...f, job_description: e.target.value }))}
                placeholder="Paste the posting text — powers the job-match comparison in the detail view."
                className="min-h-[70px] text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-notes">Notes</Label>
              <Textarea
                id="create-notes"
                value={createForm.notes}
                onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Add recruiter details, deadlines, or context…"
                className="text-xs"
              />
            </div>
          </div>
          <DialogFooter className="mt-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={handleCreateSubmit} disabled={creating} className="gap-2">
              {creating && <Loader2 className="h-4 w-4 animate-spin" />}
              Add to pipeline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={deleteTarget != null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm rounded-xl">
          <DialogHeader>
            <DialogTitle>Remove application?</DialogTitle>
            <p className="text-sm text-muted-foreground">
              {deleteTarget && (
                <>
                  This permanently removes <strong className="text-foreground">{deleteTarget.job_title}</strong> at{' '}
                  <strong className="text-foreground">{deleteTarget.company}</strong>, including its status history.
                  This can't be undone.
                </>
              )}
            </p>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirmed} disabled={deleting} className="gap-2">
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail drawer */}
      <Sheet open={selectedId != null} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[520px]">
          {detailLoading && (
            <div className="space-y-3 p-6">
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-24" />
              <Skeleton className="h-40" />
            </div>
          )}

          {!detailLoading && detailError && (
            <div className="flex flex-col items-center gap-3 p-10 text-center">
              <p className="text-sm text-muted-foreground">Could not load this application.</p>
              <Button variant="outline" size="sm" onClick={() => selectedId != null && loadDetail(selectedId)}>
                Retry
              </Button>
            </div>
          )}

          {!detailLoading && detail && editDraft && (
            <>
              <div className="flex min-h-[89px] items-center gap-[11px] border-b border-border px-[21px] py-[18px]">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-foreground/80 font-heading text-sm font-bold text-white">
                  {initials(detail.application.company)}
                </span>
                <div className="min-w-0">
                  <SheetTitle className="truncate font-heading text-base font-bold text-foreground">
                    {detail.application.company}
                  </SheetTitle>
                  <SheetDescription className="mt-[3px] truncate text-[9px]">
                    {detail.application.job_title}
                  </SheetDescription>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-[21px] pb-[26px]">
                <div className="flex min-h-[48px] flex-wrap items-center gap-2 border-b border-border py-3">
                  <Badge variant={badgeVariantForColumn(STATUS_TO_COLUMN[detail.application.status] ?? 'saved')}>
                    {STAGE_LABELS[detail.application.status]}
                  </Badge>
                  <span className="text-[8px] text-muted-foreground">
                    Last updated {relativeTime(detail.application.updated_at)}
                  </span>
                  <div className="ml-auto">
                    <StageSelect
                      value={detail.application.status}
                      disabled={detailStatusSaving}
                      onChange={handleDetailStatusChange}
                      triggerClassName="h-8 gap-1.5 rounded-md border border-border bg-card px-2.5 text-[11px] font-bold text-foreground"
                    >
                      <span className="flex items-center gap-1">
                        {detailStatusSaving && <Loader2 className="h-3 w-3 animate-spin" />}
                        Move stage
                      </span>
                    </StageSelect>
                  </div>
                </div>

                {(detail.application.location || detail.application.salary_range || detail.application.job_url) && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border py-3 text-[9px] text-muted-foreground">
                    {detail.application.location && <span>{detail.application.location}</span>}
                    {detail.application.salary_range && <span>{detail.application.salary_range}</span>}
                    {detail.application.job_url && (
                      <a
                        href={detail.application.job_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 font-bold text-primary hover:underline"
                      >
                        View posting <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </div>
                )}

                {detail.status_history.length > 0 && (
                  <section className="border-b border-border py-[18px]">
                    <h3 className="font-heading text-[12px] font-bold text-foreground">Status timeline</h3>
                    <div className="mt-3 grid">
                      {detail.status_history.map((entry, index) => (
                        <div
                          key={`${entry.changed_at}-${index}`}
                          className="relative grid min-h-[46px] grid-cols-[23px_1fr] items-start gap-2"
                        >
                          {index < detail.status_history.length - 1 && (
                            <span className="absolute bottom-[-2px] left-[11px] top-[23px] w-px bg-border" />
                          )}
                          <span className="z-[1] grid h-[23px] w-[23px] place-items-center rounded-full border border-success bg-success text-white">
                            <Check size={11} />
                          </span>
                          <div>
                            <strong className="text-[9px] text-foreground">
                              {entry.from_status ? `${STAGE_LABELS[entry.from_status]} → ` : 'Added as '}
                              {STAGE_LABELS[entry.to_status]}
                            </strong>
                            <p className="mt-0.5 text-[8px] text-muted-foreground">{formatDate(entry.changed_at)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {!editing ? (
                  <>
                    <section className="border-b border-border py-[18px]">
                      <div className="flex items-center justify-between">
                        <h3 className="font-heading text-[12px] font-bold text-foreground">Notes</h3>
                        <Button variant="ghost" size="sm" className="h-auto p-0 text-primary" onClick={() => setEditing(true)}>
                          Edit details
                        </Button>
                      </div>
                      {detail.application.notes ? (
                        <div className="mt-2.5 flex gap-2 rounded-lg bg-secondary p-3 text-primary">
                          <MessageSquareText size={15} className="mt-0.5 shrink-0" />
                          <p className="text-[9px] leading-relaxed text-foreground/80">{detail.application.notes}</p>
                        </div>
                      ) : (
                        <p className="mt-2.5 text-[9px] italic text-muted-foreground">No notes yet.</p>
                      )}
                    </section>

                    <section className="border-b border-border py-[18px]">
                      <h3 className="font-heading text-[12px] font-bold text-foreground">Contacts</h3>
                      {detail.application.recruiter_name || detail.application.recruiter_email ? (
                        <div className="mt-2.5 grid grid-cols-[28px_1fr_28px] items-center gap-2 border-t border-border py-2.5">
                          <span className="grid h-7 w-7 place-items-center rounded-full bg-secondary text-[8px] font-bold text-primary">
                            {initials(detail.application.recruiter_name || detail.application.recruiter_email || '?')}
                          </span>
                          <div className="min-w-0">
                            <strong className="block truncate text-[9px] text-foreground">
                              {detail.application.recruiter_name || detail.application.recruiter_email}
                            </strong>
                            {detail.application.recruiter_name && detail.application.recruiter_email && (
                              <small className="mt-0.5 block truncate text-[8px] text-muted-foreground">
                                {detail.application.recruiter_email}
                              </small>
                            )}
                          </div>
                          {detail.application.recruiter_email && (
                            <a
                              href={`mailto:${detail.application.recruiter_email}`}
                              aria-label="Email contact"
                              className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-primary"
                            >
                              <Mail size={14} />
                            </a>
                          )}
                        </div>
                      ) : (
                        <p className="mt-2.5 text-[9px] italic text-muted-foreground">No recruiter contact saved yet.</p>
                      )}
                    </section>
                  </>
                ) : (
                  <section className="border-b border-border py-[18px]">
                    <h3 className="font-heading text-[12px] font-bold text-foreground">Edit details</h3>
                    <div className="mt-3 grid gap-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="edit-title">Role title</Label>
                          <Input
                            id="edit-title"
                            value={editDraft.job_title}
                            onChange={(e) => setEditDraft((d) => (d ? { ...d, job_title: e.target.value } : d))}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="edit-company">Company</Label>
                          <Input
                            id="edit-company"
                            value={editDraft.company}
                            onChange={(e) => setEditDraft((d) => (d ? { ...d, company: e.target.value } : d))}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="edit-location">Location</Label>
                          <Input
                            id="edit-location"
                            value={editDraft.location}
                            onChange={(e) => setEditDraft((d) => (d ? { ...d, location: e.target.value } : d))}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="edit-salary">Salary range</Label>
                          <Input
                            id="edit-salary"
                            value={editDraft.salary_range}
                            onChange={(e) => setEditDraft((d) => (d ? { ...d, salary_range: e.target.value } : d))}
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="edit-url">Posting URL</Label>
                        <Input
                          id="edit-url"
                          value={editDraft.job_url}
                          onChange={(e) => setEditDraft((d) => (d ? { ...d, job_url: e.target.value } : d))}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="edit-recruiter-name" className="flex items-center gap-1.5">
                            <User className="h-3 w-3" /> Recruiter name
                          </Label>
                          <Input
                            id="edit-recruiter-name"
                            value={editDraft.recruiter_name}
                            onChange={(e) => setEditDraft((d) => (d ? { ...d, recruiter_name: e.target.value } : d))}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="edit-recruiter-email" className="flex items-center gap-1.5">
                            <Mail className="h-3 w-3" /> Recruiter email
                          </Label>
                          <Input
                            id="edit-recruiter-email"
                            value={editDraft.recruiter_email}
                            onChange={(e) => setEditDraft((d) => (d ? { ...d, recruiter_email: e.target.value } : d))}
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="edit-notes">Notes</Label>
                        <Textarea
                          id="edit-notes"
                          value={editDraft.notes}
                          onChange={(e) => setEditDraft((d) => (d ? { ...d, notes: e.target.value } : d))}
                          className="min-h-[90px] text-xs"
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditing(false)
                            setEditDraft(draftFromDetail(detail))
                          }}
                          disabled={savingDetail}
                        >
                          Cancel
                        </Button>
                        <Button onClick={handleSaveDetail} disabled={savingDetail} size="sm" className="gap-2">
                          {savingDetail && <Loader2 className="h-4 w-4 animate-spin" />}
                          Save changes
                        </Button>
                      </div>
                    </div>
                  </section>
                )}

                {detail.resume && (
                  <section className="border-b border-border py-[18px]">
                    <h3 className="font-heading text-[12px] font-bold text-foreground">Application assets</h3>
                    <div className="mt-2.5 grid gap-1.5">
                      <Button variant="outline" asChild className="h-auto justify-start gap-2.5 py-2.5">
                        <Link to={`/resume/tailor?analysisId=${detail.resume.analysis_id}`}>
                          <FileText size={16} />
                          <span className="grid text-left">
                            <small className="text-[7px] uppercase tracking-wide text-muted-foreground">Resume</small>
                            <strong className="text-[10px] text-foreground">
                              {detail.resume.filename} · {detail.resume.ats_score}% {detail.resume.band}
                            </strong>
                          </span>
                        </Link>
                      </Button>
                    </div>
                  </section>
                )}

                {detail.application.job_description && (
                  <section className="border-b border-border py-[18px]">
                    <h3 className="flex items-center gap-1.5 font-heading text-[12px] font-bold text-foreground">
                      <Briefcase size={13} /> Job description
                    </h3>
                    <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-[9px] leading-relaxed text-muted-foreground">
                      {detail.application.job_description}
                    </p>
                  </section>
                )}

                {detail.job_match && (
                  <section className="border-b border-border py-[18px]">
                    <div className="flex items-center justify-between">
                      <h3 className="font-heading text-[12px] font-bold text-foreground">Job match</h3>
                      {detail.job_match.overall_match != null && (
                        <Badge variant="subtle" className="text-[9px]">
                          {Math.round(detail.job_match.overall_match)}% · {detail.job_match.band}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1.5 text-[9px] text-muted-foreground">{detail.job_match.explanation}</p>
                    {detail.job_match.missing_skills.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {detail.job_match.missing_skills.map((skill) => (
                          <span
                            key={skill}
                            className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning-tint px-2 py-1 text-[8px] font-bold text-warning"
                          >
                            + {skill}
                          </span>
                        ))}
                      </div>
                    )}
                  </section>
                )}

                {(detail.interview || detail.has_in_progress_interview) && (
                  <section className="border-b border-border py-[18px]">
                    <h3 className="flex items-center gap-1.5 font-heading text-[12px] font-bold text-foreground">
                      <Sparkles size={13} /> Interview practice
                    </h3>
                    {detail.interview ? (
                      <div className="mt-2">
                        <div className="flex items-center justify-between text-[9px]">
                          <span className="font-medium text-foreground">Overall score</span>
                          <Badge variant="subtle" className="text-[9px]">
                            {Math.round(detail.interview.overall_score)}% · {detail.interview.readiness_band}
                          </Badge>
                        </div>
                        <p className="mt-1 text-[8px] text-muted-foreground">
                          Completed {formatDate(detail.interview.completed_at)}
                        </p>
                      </div>
                    ) : (
                      <p className="mt-2 text-[9px] text-muted-foreground">A practice session for this role is in progress.</p>
                    )}
                  </section>
                )}

                <div className="pt-[18px]">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setDeleteTarget(detail.application)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove application
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
