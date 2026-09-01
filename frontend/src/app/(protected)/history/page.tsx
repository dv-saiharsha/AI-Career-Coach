'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import * as Tabs from '@radix-ui/react-tabs'
import CountUp from 'react-countup'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { TrendChart } from '@/components/charts/TrendChart'
import {
  FileSearch,
  MessageSquareCode,
  Target,
  TrendingUp,
  Download,
  AlertCircle,
  Inbox,
  LineChart,
  Eye,
  Trash2,
  Check,} from 'lucide-react'
import {
  downloadResumeReport,
  viewOriginalResume,
  deleteResumeAnalysis,
  getInterviewHistory,
  getResumeHistory,
  type InterviewHistoryItem,
  type ResumeHistoryItem,
} from '../../../lib/apiClient'
import { useAccentPalette, useChartTheme } from '../../../lib/useAccentPalette'

const FILTERS = ['All', 'Resume', 'Interview'] as const
type Filter = (typeof FILTERS)[number]

type TimelineItem =
  | { kind: 'resume'; id: number; date: string; title: string; score: number }
  | {
      kind: 'interview'
      id: number
      date: string
      title: string
      score: number | null
      answered: number
      total: number
    }

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function ScoreRing({ score, size = 38 }: { score: number | null; size?: number }) {
  const palette = useAccentPalette()
  const chart = useChartTheme()
  const stroke = 3.5
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const pct = score === null ? 0 : Math.min(100, Math.max(0, score))
  const offset = circumference - (pct / 100) * circumference
  const color = score === null ? palette.inkFaint : score >= 85 ? palette.accentLighter : score >= 70 ? palette.accent : palette.accentDim
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={chart.grid} strokeWidth={stroke} />
        {score !== null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            /* The offset IS the score — without it the ring draws full at
               every value. It grows from empty via a CSS transition. */
            strokeDashoffset={offset}
            className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-700 motion-safe:ease-(--ease-enter)"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-(--color-ink) tabular-nums">
        {score === null ? '—' : Math.round(score)}
      </div>
    </div>
  )
}

function TrendCard({
  title,
  sub,
  data,
  unit,
  gradientId,
}: {
  title: string
  sub: string
  data: { date: string; score: number }[]
  unit: string
  gradientId: string
}) {
  return (
    <div className="bg-(--color-canvas-raise) border border-(--color-canvas-line-soft) rounded-2xl p-6">
      <h2 className="text-sm font-semibold text-(--color-ink) mb-1">{title}</h2>
      <p className="text-xs text-(--color-ink-faint) mb-4">{sub}</p>
      {data.length >= 2 ? (
        <TrendChart
          id={gradientId}
          points={data}
          unit={unit}
          height={180}
          summary={`${title}: ${data.length} points, from ${data[0].score}${unit} on ${data[0].date} to ${data[data.length - 1].score}${unit} on ${data[data.length - 1].date}.`}
        />
      ) : (
        <div className="h-[160px] flex flex-col items-center justify-center gap-2 text-center">
          <LineChart className="w-5 h-5 text-(--color-ink-faint)" />
          <p className="text-xs text-(--color-ink-faint) max-w-[220px]">
            Not enough data yet — keep going and your trend will appear here.
          </p>
        </div>
      )}
    </div>
  )
}

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`bg-(--color-canvas-raise) border border-(--color-canvas-line-soft) rounded-2xl animate-pulse ${className}`} />
}

export default function History() {
  const [resumeHistory, setResumeHistory] = useState<ResumeHistoryItem[]>([])
  // Delete is two-step: the first click arms it, the second commits. Tracked
  // by id so arming one row cannot arm another.
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [actionError, setActionError] = useState<number | null>(null)
  const [interviewHistory, setInterviewHistory] = useState<InterviewHistoryItem[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [filter, setFilter] = useState<Filter>('All')

  useEffect(() => {
    Promise.all([getResumeHistory(), getInterviewHistory()])
      .then(([resumes, interviews]) => {
        setResumeHistory(resumes)
        setInterviewHistory(interviews)
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }, [])

  const resumeTrend = useMemo(
    () =>
      [...resumeHistory]
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map((item) => ({ date: formatDate(item.created_at), score: Math.round(item.ats_score) })),
    [resumeHistory],
  )

  const interviewTrend = useMemo(
    () =>
      [...interviewHistory]
        .filter((item) => item.average_score !== null)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map((item) => ({ date: formatDate(item.created_at), score: item.average_score as number })),
    [interviewHistory],
  )

  const timeline = useMemo<TimelineItem[]>(() => {
    const resumeItems: TimelineItem[] = resumeHistory.map((item) => ({
      kind: 'resume',
      id: item.id,
      date: item.created_at,
      title: item.resume_filename,
      score: Math.round(item.ats_score),
    }))
    const interviewItems: TimelineItem[] = interviewHistory.map((item) => ({
      kind: 'interview',
      id: item.id,
      date: item.created_at,
      title: `${item.role} · ${item.seniority}`,
      score: item.average_score,
      answered: item.answered_count,
      total: item.question_count,
    }))
    return [...resumeItems, ...interviewItems].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    )
  }, [resumeHistory, interviewHistory])

  const filteredTimeline = useMemo(() => {
    if (filter === 'Resume') return timeline.filter((t) => t.kind === 'resume')
    if (filter === 'Interview') return timeline.filter((t) => t.kind === 'interview')
    return timeline
  }, [timeline, filter])

  const bestAts = resumeHistory.length ? Math.max(...resumeHistory.map((r) => r.ats_score)) : 0
  const scoredInterviews = interviewHistory.filter((i) => i.average_score !== null)
  const avgInterview = scoredInterviews.length
    ? scoredInterviews.reduce((sum, i) => sum + (i.average_score as number), 0) / scoredInterviews.length
    : 0

  const STAT_CARDS = [
    { icon: FileSearch, label: 'Resume Scans', value: resumeHistory.length, suffix: '', decimals: 0 },
    { icon: Target, label: 'Best ATS Score', value: Math.round(bestAts), suffix: '%', decimals: 0 },
    { icon: MessageSquareCode, label: 'Interview Sessions', value: interviewHistory.length, suffix: '', decimals: 0 },
    { icon: TrendingUp, label: 'Avg Interview Score', value: avgInterview, suffix: '/10', decimals: 1 },
  ]

  const isEmpty = status === 'ready' && resumeHistory.length === 0 && interviewHistory.length === 0

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        eyebrow="History"
        eyebrowIcon={TrendingUp}
        title="Everything you've run so far."
        description="Every scan and every rehearsed answer, saved so you can track progress over time."
      />

      {status === 'error' && (
        <div
         
         
          className="flex items-center gap-3 bg-[#EF4444]/5 border border-[#EF4444]/20 rounded-2xl px-5 py-4 panel-enter"
        >
          <AlertCircle className="w-4 h-4 text-[#EF4444] shrink-0" />
          <p className="text-sm text-(--color-ink-dim)">Couldn&rsquo;t load your history. Try refreshing.</p>
        </div>
      )}

      {status !== 'error' && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {status === 'loading'
              ? Array.from({ length: 4 }).map((_, i) => <SkeletonBlock key={i} className="h-[104px]" />)
              : STAT_CARDS.map(({ icon: Icon, label, value, suffix, decimals }) => (
                  <div
                    key={label}
                   
                   
                   
                    className="bg-(--color-canvas-raise) border border-(--color-canvas-line-soft) rounded-2xl p-5 hover:border-(--color-canvas-line) transition-colors panel-enter"
                  >
                    <div className="w-8 h-8 rounded-lg bg-(--color-accent)/10 flex items-center justify-center mb-3">
                      <Icon className="w-4 h-4 text-(--color-accent)" />
                    </div>
                    <div className="text-xl font-display font-bold text-(--color-accent) tabular-nums">
                      <CountUp end={value} duration={1.4} decimals={decimals} suffix={suffix} />
                    </div>
                    <div className="text-xs font-medium text-(--color-ink) mt-0.5">{label}</div>
                  </div>
                ))}
          </div>

          {/* Trend charts */}
          {status === 'loading' ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <SkeletonBlock className="h-[236px]" />
              <SkeletonBlock className="h-[236px]" />
            </div>
          ) : (
            !isEmpty && (
              <div
               
               
               
                className="grid grid-cols-1 lg:grid-cols-2 gap-5 panel-enter"
              >
                <TrendCard
                  title="ATS Score Trend"
                  sub="Resume scans over time"
                  data={resumeTrend}
                  unit="%"
                  gradientId="historyAtsFill"
                />
                <TrendCard
                  title="Interview Score Trend"
                  sub="Average score per session"
                  data={interviewTrend}
                  unit="/10"
                  gradientId="historyInterviewFill"
                />
              </div>
            )
          )}

          {/* Timeline */}
          {!isEmpty && (
            <>
              <div className="panel-enter">
                <Tabs.Root value={filter} onValueChange={(v) => setFilter(v as Filter)}>
                  <Tabs.List className="flex items-center gap-1">
                    {FILTERS.map((f) => (
                      <Tabs.Trigger
                        key={f}
                        value={f}
                        className="px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all border border-transparent text-(--color-ink-faint) hover:text-(--color-ink-dim) hover:bg-canvas-elevated data-[state=active]:border-(--color-accent)/20 data-[state=active]:text-(--color-accent) data-[state=active]:bg-(--color-accent)/10"
                      >
                        {f}
                      </Tabs.Trigger>
                    ))}
                  </Tabs.List>
                </Tabs.Root>
              </div>

              <div
               
               
               
                className="bg-(--color-canvas-raise) border border-(--color-canvas-line-soft) rounded-2xl overflow-hidden panel-enter"
              >
                {status === 'loading' ? (
                  <div className="divide-y divide-(--color-canvas)">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="h-[72px] animate-pulse bg-(--color-canvas-raise)" />
                    ))}
                  </div>
                ) : filteredTimeline.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-14 px-6 text-center">
                    <div className="w-11 h-11 rounded-xl bg-(--color-accent)/10 flex items-center justify-center">
                      <Inbox className="w-5 h-5 text-(--color-accent)" />
                    </div>
                    <p className="text-sm text-(--color-ink-dim)">No {filter.toLowerCase()} activity yet.</p>
                  </div>
                ) : (
                  <>
                    {filteredTimeline.map((item) => (
                      <div
                        key={`${item.kind}-${item.id}`}
                       
                       
                       
                       
                        className="flex items-center gap-4 px-5 py-4 border-b border-(--color-canvas) hover:bg-white/[0.03] transition-colors last:border-0 panel-enter"
                      >
                        <div
                          className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                            item.kind === 'resume' ? 'bg-(--color-accent)/10' : 'bg-(--color-accent-light)/10'
                          }`}
                        >
                          {item.kind === 'resume' ? (
                            <FileSearch className="w-4 h-4 text-(--color-accent)" />
                          ) : (
                            <MessageSquareCode className="w-4 h-4 text-(--color-accent-light)" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-(--color-ink) truncate">{item.title}</div>
                          <div className="flex items-center gap-2 text-xs text-(--color-ink-faint) mt-0.5">
                            <span
                              className={`px-1.5 py-0.5 rounded-full font-medium ${
                                item.kind === 'resume' ? 'bg-(--color-accent)/10 text-(--color-accent)' : 'bg-(--color-accent-light)/10 text-(--color-accent-light)'
                              }`}
                            >
                              {item.kind === 'resume' ? 'Resume' : 'Interview'}
                            </span>
                            <span>{formatDate(item.date)}</span>
                            {item.kind === 'interview' && (
                              <span className="hidden sm:inline">
                                &middot; {item.answered}/{item.total} answered
                              </span>
                            )}
                          </div>
                        </div>

                        <ScoreRing score={item.score} />

                        {item.kind === 'resume' ? (
                          <div className="flex shrink-0 items-center gap-0.5">
                            {/* A failed view or delete must say so — silently
                                doing nothing reads as a dead button. */}
                            {actionError === item.id && (
                              <span className="mr-1 text-[10px] text-(--color-signal-low)">
                                Didn&apos;t work
                              </span>
                            )}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => { setActionError(null); viewOriginalResume(item.id).catch(() => setActionError(item.id)) }}
                              aria-label="View original resume"
                            >
                              <Eye />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => downloadResumeReport(item.id, `resume-report-${item.id}.pdf`)}
                              aria-label="Download feedback report"
                            >
                              <Download />
                            </Button>
                            {/* Two-step rather than a modal: one stray click
                                should not destroy a scan, but a confirm dialog
                                for a reversible-by-re-uploading action is
                                heavier than it needs to be. */}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => {
                                setActionError(null)
                                if (confirmingId !== item.id) { setConfirmingId(item.id); return }
                                setDeletingId(item.id)
                                deleteResumeAnalysis(item.id)
                                  .then(() => setResumeHistory((rows) => rows.filter((r) => r.id !== item.id)))
                                  .catch(() => setActionError(item.id))
                                  .finally(() => { setDeletingId(null); setConfirmingId(null) })
                              }}
                              onBlur={() => setConfirmingId((id) => (id === item.id ? null : id))}
                              disabled={deletingId === item.id}
                              aria-label={confirmingId === item.id ? 'Confirm delete' : 'Delete scan'}
                              style={confirmingId === item.id ? { color: 'var(--color-signal-low)' } : undefined}
                            >
                              {confirmingId === item.id ? <Check /> : <Trash2 />}
                            </Button>
                          </div>
                        ) : (
                          <div className="w-8 shrink-0" />
                        )}
                      </div>
                    ))}
                  </>
                )}
              </div>
            </>
          )}

          {/* Empty state */}
          {isEmpty && (
            <div
             
             
              className="flex flex-col items-center justify-center gap-4 bg-(--color-canvas-raise) border border-(--color-canvas-line-soft) rounded-2xl py-20 px-6 text-center panel-enter"
            >
              <div className="w-12 h-12 rounded-2xl bg-(--color-accent)/10 flex items-center justify-center">
                <Inbox className="w-6 h-6 text-(--color-accent)" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-(--color-ink) mb-1">Nothing here yet</h2>
                <p className="text-sm text-(--color-ink-dim) max-w-sm">
                  Scan a resume or practice a mock interview and it&rsquo;ll show up here.
                </p>
              </div>
            </div>
          )}

          {/* CTAs */}
          <div
           
           
           
            className="flex flex-wrap gap-3 panel-enter"
          >
            <Link
              href="/resume"
              className="flex items-center gap-2 bg-(--color-canvas-raise) border border-(--color-canvas-line) text-(--color-ink) px-4 py-2.5 rounded-xl text-sm font-medium hover:border-(--color-accent)/30 hover:text-(--color-accent) transition-all"
            >
              <FileSearch className="w-4 h-4" />
              Scan another resume
            </Link>
            <Link
              href="/interview"
              className="flex items-center gap-2 bg-(--color-canvas-raise) border border-(--color-canvas-line) text-(--color-ink) px-4 py-2.5 rounded-xl text-sm font-medium hover:border-(--color-accent)/30 hover:text-(--color-accent) transition-all"
            >
              <MessageSquareCode className="w-4 h-4" />
              Practice another question
            </Link>
          </div>
        </>
      )}
    </div>
  )
}
