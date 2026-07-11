'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import * as Tabs from '@radix-ui/react-tabs'
import CountUp from 'react-countup'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'

interface TrendTooltipProps {
  active?: boolean
  payload?: { value?: number }[]
  label?: string
  unit?: string
}
import {
  FileSearch,
  MessageSquareCode,
  Target,
  TrendingUp,
  Download,
  AlertCircle,
  Inbox,
  LineChart,
} from 'lucide-react'
import {
  downloadResumeReport,
  getInterviewHistory,
  getResumeHistory,
  type InterviewHistoryItem,
  type ResumeHistoryItem,
} from '../../../lib/apiClient'
import { useAccentPalette } from '../../../lib/useAccentPalette'

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
  const stroke = 3.5
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const pct = score === null ? 0 : Math.min(100, Math.max(0, score))
  const offset = circumference - (pct / 100) * circumference
  const color = score === null ? palette.inkFaint : score >= 85 ? palette.accentLighter : score >= 70 ? palette.accent : palette.accentDim
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1e1e1e" strokeWidth={stroke} />
        {score !== null && (
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1, ease: 'easeOut', delay: 0.15 }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-[var(--color-ink)] tabular-nums">
        {score === null ? '—' : Math.round(score)}
      </div>
    </div>
  )
}

function TrendTooltip({ active, payload, label, unit }: TrendTooltipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line)] rounded-xl px-3.5 py-2.5 shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
      <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--color-ink-faint)] mb-1">{label}</div>
      <div className="text-xs font-semibold text-[var(--color-ink)] tabular-nums">
        {payload[0].value}
        {unit}
      </div>
    </div>
  )
}

function TrendCard({
  title,
  sub,
  data,
  color,
  unit,
  gradientId,
}: {
  title: string
  sub: string
  data: { date: string; score: number }[]
  color: string
  unit: string
  gradientId: string
}) {
  const palette = useAccentPalette()
  return (
    <div className="bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line-soft)] rounded-2xl p-6">
      <h2 className="text-sm font-semibold text-[var(--color-ink)] mb-1">{title}</h2>
      <p className="text-xs text-[var(--color-ink-faint)] mb-4">{sub}</p>
      {data.length >= 2 ? (
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={data} margin={{ top: 4, right: 8, left: -30, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.32} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="#1e1e1e" strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: palette.inkFaint }} axisLine={false} tickLine={false} />
            <YAxis hide />
            <Tooltip content={<TrendTooltip unit={unit} />} cursor={{ stroke: palette.inkFaint, strokeWidth: 1 }} />
            <Area
              type="monotone"
              dataKey="score"
              stroke={color}
              strokeWidth={2.5}
              fill={`url(#${gradientId})`}
              dot={{ r: 3, fill: color, strokeWidth: 0 }}
              activeDot={{ r: 5, strokeWidth: 0 }}
              isAnimationActive
              animationDuration={900}
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-[160px] flex flex-col items-center justify-center gap-2 text-center">
          <LineChart className="w-5 h-5 text-[var(--color-ink-faint)]" />
          <p className="text-xs text-[var(--color-ink-faint)] max-w-[220px]">
            Not enough data yet — keep going and your trend will appear here.
          </p>
        </div>
      )}
    </div>
  )
}

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line-soft)] rounded-2xl animate-pulse ${className}`} />
}

export default function History() {
  const palette = useAccentPalette()
  const violet = palette.accent
  const violetLight = palette.accentLight
  const [resumeHistory, setResumeHistory] = useState<ResumeHistoryItem[]>([])
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
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-display font-semibold text-[var(--color-ink)] mb-1">History</h1>
        <p className="text-sm text-[var(--color-ink-dim)]">
          Every scan and every rehearsed answer, saved so you can track progress over time.
        </p>
      </motion.div>

      {status === 'error' && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 bg-[#EF4444]/5 border border-[#EF4444]/20 rounded-2xl px-5 py-4"
        >
          <AlertCircle className="w-4 h-4 text-[#EF4444] shrink-0" />
          <p className="text-sm text-[var(--color-ink-dim)]">Couldn&rsquo;t load your history. Try refreshing.</p>
        </motion.div>
      )}

      {status !== 'error' && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {status === 'loading'
              ? Array.from({ length: 4 }).map((_, i) => <SkeletonBlock key={i} className="h-[104px]" />)
              : STAT_CARDS.map(({ icon: Icon, label, value, suffix, decimals }, i) => (
                  <motion.div
                    key={label}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.07 }}
                    className="bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line-soft)] rounded-2xl p-5 hover:border-[var(--color-canvas-line)] transition-colors"
                  >
                    <div className="w-8 h-8 rounded-lg bg-[var(--color-accent)]/10 flex items-center justify-center mb-3">
                      <Icon className="w-4 h-4 text-[var(--color-accent)]" />
                    </div>
                    <div className="text-xl font-display font-bold text-[var(--color-accent)] tabular-nums">
                      <CountUp end={value} duration={1.4} decimals={decimals} suffix={suffix} />
                    </div>
                    <div className="text-xs font-medium text-[var(--color-ink)] mt-0.5">{label}</div>
                  </motion.div>
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
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="grid grid-cols-1 lg:grid-cols-2 gap-5"
              >
                <TrendCard
                  title="ATS Score Trend"
                  sub="Resume scans over time"
                  data={resumeTrend}
                  color={violet}
                  unit="%"
                  gradientId="historyAtsFill"
                />
                <TrendCard
                  title="Interview Score Trend"
                  sub="Average score per session"
                  data={interviewTrend}
                  color={violetLight}
                  unit="/10"
                  gradientId="historyInterviewFill"
                />
              </motion.div>
            )
          )}

          {/* Timeline */}
          {!isEmpty && (
            <>
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                <Tabs.Root value={filter} onValueChange={(v) => setFilter(v as Filter)}>
                  <Tabs.List className="flex items-center gap-1">
                    {FILTERS.map((f) => (
                      <Tabs.Trigger
                        key={f}
                        value={f}
                        className="px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all border border-transparent text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)] hover:bg-white/5 data-[state=active]:border-[var(--color-accent)]/20 data-[state=active]:text-[var(--color-accent)] data-[state=active]:bg-[var(--color-accent)]/10"
                      >
                        {f}
                      </Tabs.Trigger>
                    ))}
                  </Tabs.List>
                </Tabs.Root>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
                className="bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line-soft)] rounded-2xl overflow-hidden"
              >
                {status === 'loading' ? (
                  <div className="divide-y divide-[var(--color-canvas)]">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="h-[72px] animate-pulse bg-[var(--color-canvas-raise)]" />
                    ))}
                  </div>
                ) : filteredTimeline.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-14 px-6 text-center">
                    <div className="w-11 h-11 rounded-xl bg-[var(--color-accent)]/10 flex items-center justify-center">
                      <Inbox className="w-5 h-5 text-[var(--color-accent)]" />
                    </div>
                    <p className="text-sm text-[var(--color-ink-dim)]">No {filter.toLowerCase()} activity yet.</p>
                  </div>
                ) : (
                  <AnimatePresence initial={false}>
                    {filteredTimeline.map((item, i) => (
                      <motion.div
                        key={`${item.kind}-${item.id}`}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ delay: Math.min(i, 8) * 0.05, duration: 0.35 }}
                        className="flex items-center gap-4 px-5 py-4 border-b border-[var(--color-canvas)] hover:bg-white/[0.03] transition-colors last:border-0"
                      >
                        <div
                          className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                            item.kind === 'resume' ? 'bg-[var(--color-accent)]/10' : 'bg-[var(--color-accent-light)]/10'
                          }`}
                        >
                          {item.kind === 'resume' ? (
                            <FileSearch className="w-4 h-4 text-[var(--color-accent)]" />
                          ) : (
                            <MessageSquareCode className="w-4 h-4 text-[var(--color-accent-light)]" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-[var(--color-ink)] truncate">{item.title}</div>
                          <div className="flex items-center gap-2 text-xs text-[var(--color-ink-faint)] mt-0.5">
                            <span
                              className={`px-1.5 py-0.5 rounded-full font-medium ${
                                item.kind === 'resume' ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'bg-[var(--color-accent-light)]/10 text-[var(--color-accent-light)]'
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
                          <button
                            type="button"
                            onClick={() => downloadResumeReport(item.id, `resume-report-${item.id}.pdf`)}
                            className="p-2 rounded-lg text-[var(--color-ink-faint)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors shrink-0"
                            aria-label="Download report"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        ) : (
                          <div className="w-8 shrink-0" />
                        )}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                )}
              </motion.div>
            </>
          )}

          {/* Empty state */}
          {isEmpty && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center gap-4 bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line-soft)] rounded-2xl py-20 px-6 text-center"
            >
              <div className="w-12 h-12 rounded-2xl bg-[var(--color-accent)]/10 flex items-center justify-center">
                <Inbox className="w-6 h-6 text-[var(--color-accent)]" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-[var(--color-ink)] mb-1">Nothing here yet</h2>
                <p className="text-sm text-[var(--color-ink-dim)] max-w-sm">
                  Scan a resume or practice a mock interview and it&rsquo;ll show up here.
                </p>
              </div>
            </motion.div>
          )}

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="flex flex-wrap gap-3"
          >
            <Link
              href="/resume"
              className="flex items-center gap-2 bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line)] text-[var(--color-ink)] px-4 py-2.5 rounded-xl text-sm font-medium hover:border-[var(--color-accent)]/30 hover:text-[var(--color-accent)] transition-all"
            >
              <FileSearch className="w-4 h-4" />
              Scan another resume
            </Link>
            <Link
              href="/interview"
              className="flex items-center gap-2 bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line)] text-[var(--color-ink)] px-4 py-2.5 rounded-xl text-sm font-medium hover:border-[var(--color-accent)]/30 hover:text-[var(--color-accent)] transition-all"
            >
              <MessageSquareCode className="w-4 h-4" />
              Practice another question
            </Link>
          </motion.div>
        </>
      )}
    </div>
  )
}
