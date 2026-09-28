import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Briefcase, FileSearch, MessageSquareText, RotateCcw, Search, type LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { historyService } from '@/services/historyService'
import { profileService } from '@/services/profileService'
import type { HistoryEntry } from '@/types/history'
import type { ProfileSchema } from '@/types/profile'
import { STAGE_LABELS, type ApplicationStatus } from '@/types/applications'
import { cn } from '@/lib/utils'

type TypeFilter = 'all' | 'resume' | 'interview' | 'application'

const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'All activity' },
  { value: 'resume', label: 'Resume analysis' },
  { value: 'interview', label: 'Interview session' },
  { value: 'application', label: 'Application' },
]

const TYPE_TONE: Record<TypeFilter, string> = {
  all: '',
  resume: 'bg-secondary text-primary',
  interview: 'bg-coral-tint text-coral',
  application: 'bg-warning-tint text-warning',
}

const TYPE_ICON: Record<Exclude<TypeFilter, 'all'>, LucideIcon> = {
  resume: FileSearch,
  interview: MessageSquareText,
  application: Briefcase,
}

function dateBucketLabel(iso: string | null | undefined): string {
  const date = iso ? new Date(iso) : null
  if (!date || Number.isNaN(date.getTime())) return 'Unknown date'
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

function timeLabel(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function entrySearchText(entry: HistoryEntry): string {
  if (entry.type === 'resume') return entry.resume_filename
  if (entry.type === 'interview') return `${entry.seniority} ${entry.role} ${entry.category ?? ''}`
  return `${entry.job_title} ${entry.company} ${STAGE_LABELS[entry.to_status as ApplicationStatus] ?? entry.to_status}`
}

interface Row {
  key: string
  iso: string | null
  type: Exclude<TypeFilter, 'all'>
  title: string
  detail: string
  primary: { label: string; onClick: () => void }
  secondary?: { label: string; onClick: () => void }
}

export function HistoryPage() {
  const navigate = useNavigate()
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [profile, setProfile] = useState<ProfileSchema | null>(null)
  const [search, setSearch] = useState('')
  const [type, setType] = useState<TypeFilter>('all')

  const load = () => {
    historyService
      .getUnifiedHistory()
      .then(setEntries)
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : 'Failed to load your history.')
        setEntries([])
      })
  }

  useEffect(() => {
    load()
    profileService.getProfile().then(setProfile).catch(() => undefined)
  }, [])

  // Resume history is already sorted newest-first by the backend, so the
  // entry immediately after this one in that same list is the prior scan —
  // real data lets the row honestly say "moved from X to Y", not just "Y".
  const resumeHistoryOrder = useMemo(
    () => (entries ?? []).filter((e): e is Extract<HistoryEntry, { type: 'resume' }> => e.type === 'resume'),
    [entries]
  )

  const setPrimaryResume = async (analysisId: number, filename: string) => {
    try {
      const updated = await profileService.updateProfile({
        primary_resume_analysis_id: analysisId,
        primary_resume_filename: filename,
      })
      setProfile(updated)
      toast.success(`${filename} set as your primary resume.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not set that as your primary resume.')
    }
  }

  const rows = useMemo<Row[]>(() => {
    if (!entries) return []
    return entries.map((entry): Row => {
      if (entry.type === 'resume') {
        const olderIndex = resumeHistoryOrder.findIndex((r) => r.id === entry.id) + 1
        const older = resumeHistoryOrder[olderIndex]
        const detail = older
          ? `ATS score ${entry.ats_score >= older.ats_score ? 'improved' : 'declined'} from ${older.ats_score} to ${entry.ats_score}`
          : `ATS score ${entry.ats_score}`
        const isPrimary = profile?.primary_resume_analysis_id === entry.id
        return {
          key: `resume-${entry.id}`,
          iso: entry.created_at,
          type: 'resume',
          title: entry.resume_filename,
          detail,
          primary: { label: 'View', onClick: () => navigate('/resume/results') },
          secondary: isPrimary
            ? undefined
            : { label: 'Set as primary', onClick: () => setPrimaryResume(entry.id, entry.resume_filename) },
        }
      }
      if (entry.type === 'interview') {
        const scoreLabel = entry.average_score != null ? `Score ${entry.average_score}/10` : 'Not yet scored'
        return {
          key: `interview-${entry.id}`,
          iso: entry.created_at,
          type: 'interview',
          title: `${entry.seniority} ${entry.role}`,
          detail: `Completed ${entry.answered_count}/${entry.question_count} questions · ${scoreLabel}`,
          primary: { label: 'View', onClick: () => navigate(`/interview/feedback?id=${entry.id}`) },
          secondary: {
            label: 'Practice again',
            onClick: () =>
              navigate(
                `/interview/setup?role=${encodeURIComponent(entry.role)}${entry.category ? `&category=${entry.category}` : ''}`
              ),
          },
        }
      }
      const toLabel = STAGE_LABELS[entry.to_status as ApplicationStatus] ?? entry.to_status
      const title = entry.from_status
        ? `Moved ${entry.company} to ${toLabel}`
        : `Added ${entry.company} as ${toLabel}`
      return {
        key: `application-${entry.application_id}-${entry.changed_at}`,
        iso: entry.changed_at,
        type: 'application',
        title,
        detail: entry.job_title,
        primary: { label: 'View', onClick: () => navigate(`/applications?open=${entry.application_id}`) },
      }
    })
  }, [entries, resumeHistoryOrder, profile, navigate])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((row, i) => {
      if (type !== 'all' && row.type !== type) return false
      if (!q) return true
      const entry = entries![i]
      return entrySearchText(entry).toLowerCase().includes(q)
    })
  }, [rows, entries, search, type])

  const grouped = useMemo(() => {
    const groups = new Map<string, Row[]>()
    for (const row of filteredRows) {
      const label = dateBucketLabel(row.iso)
      if (!groups.has(label)) groups.set(label, [])
      groups.get(label)!.push(row)
    }
    return [...groups.entries()]
  }, [filteredRows])

  const loading = entries === null

  return (
    <div className="grid gap-[18px]">
      <div>
        <h2 className="font-heading text-2xl font-bold text-foreground">History</h2>
        <p className="mt-1 text-[10px] text-muted-foreground">
          Revisit every resume analysis, practice session, and application update.
        </p>
      </div>

      <Card className="flex flex-col gap-2.5 p-2.5 sm:flex-row sm:items-center">
        <div className="flex h-9 flex-1 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-muted-foreground sm:min-w-[280px]">
          <Search size={16} className="shrink-0" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your activity"
            aria-label="Search history"
            className="h-auto border-0 bg-transparent p-0 text-xs shadow-none focus-visible:ring-0"
          />
        </div>
        <Select value={type} onValueChange={(v) => setType(v as TypeFilter)}>
          <SelectTrigger className="h-9 w-full text-xs sm:w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Card>

      {loading && (
        <div className="grid gap-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[78px] w-full rounded-xl" />
          ))}
        </div>
      )}

      {!loading && filteredRows.length === 0 && (
        <Card className="border-dashed">
          <div className="flex flex-col items-center gap-3 p-12 text-center">
            <RotateCcw className="h-8 w-8 text-muted-foreground/50" />
            <p className="max-w-sm text-sm text-muted-foreground">
              {entries!.length === 0
                ? "You haven't scanned a resume, practiced an interview, or tracked an application yet."
                : 'No history matches your filters.'}
            </p>
            {entries!.length === 0 && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => navigate('/resume/upload')}>
                  Analyze resume
                </Button>
                <Button size="sm" onClick={() => navigate('/interview/setup')}>
                  Practice interview
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}

      {!loading && filteredRows.length > 0 && (
        <div className="grid gap-1">
          {grouped.map(([label, groupRows]) => (
            <section key={label}>
              <div className="my-[9px] flex items-center gap-2.5">
                <span className="text-[9px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <div className="grid gap-1.5">
                {groupRows.map((row) => {
                  const Icon = TYPE_ICON[row.type]
                  return (
                    <Card key={row.key} className="grid grid-cols-[38px_1fr_auto] items-center gap-2.5 p-3.5">
                      <span className={cn('grid h-9 w-9 place-items-center rounded-[9px]', TYPE_TONE[row.type])}>
                        <Icon size={17} />
                      </span>
                      <div className="min-w-0">
                        <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {TYPE_OPTIONS.find((o) => o.value === row.type)?.label} · {timeLabel(row.iso)}
                        </span>
                        <h3 className="truncate text-[13px] font-bold text-foreground">{row.title}</h3>
                        <p className="truncate text-[10px] text-muted-foreground">{row.detail}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {row.secondary && (
                          <Button variant="outline" size="sm" className="gap-1.5 text-[11px]" onClick={row.secondary.onClick}>
                            <RotateCcw size={12} />
                            {row.secondary.label}
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="text-[11px]" onClick={row.primary.onClick}>
                          {row.primary.label}
                        </Button>
                      </div>
                    </Card>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
