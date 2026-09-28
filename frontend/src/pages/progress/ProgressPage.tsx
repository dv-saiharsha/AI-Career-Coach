import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Check, FileText, Flame, Sparkles, TrendingUp } from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ConicRing } from '@/components/shared/ConicRing'
import { useDashboardHome } from '@/hooks/useDashboardHome'
import { computeReadinessScore } from '@/lib/readiness'
import { getScoreTone, scoreToneClass } from '@/lib/scoreTone'
import { cn } from '@/lib/utils'
import { historyService } from '@/services/historyService'
import type { DashboardHomeSchema } from '@/types/dashboard'

type Granularity = 'scan' | 'week' | 'month'

interface InterviewTrendPoint {
  date: string
  label: string
  score: number
}

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function readinessTier(score: number): string {
  if (score >= 75) return 'On track'
  if (score >= 45) return 'Building momentum'
  return 'Just getting started'
}

function AiBadge({ label = 'AI' }: { label?: string }) {
  return (
    <span className="inline-flex w-fit items-center gap-[5px] rounded-full bg-coral-tint px-[7px] py-1 text-[9px] font-extrabold uppercase tracking-[0.07em] text-coral-foreground">
      <Sparkles size={11} strokeWidth={2.5} /> {label}
    </span>
  )
}

interface Milestone {
  label: string
  description: string
  complete: boolean
}

function buildMilestones(data: DashboardHomeSchema): Milestone[] {
  return [
    {
      label: 'Resume ready',
      description: 'Analyze a resume to get a real ATS score.',
      complete: data.resume.resumes_analyzed > 0,
    },
    {
      label: 'Interview ready',
      description: 'Complete a mock interview session.',
      complete: data.interview.completed_sessions > 0,
    },
    {
      label: 'Applying',
      description: 'Track your first application in the pipeline.',
      complete: data.applications.total > 0,
    },
    {
      label: 'Interviewing',
      description: 'Reach an interview stage with a real application.',
      complete: data.analytics.funnel.reached_interviewing > 0,
    },
  ]
}

export function ProgressPage() {
  const { data, loading: homeLoading } = useDashboardHome()
  const [interviewTrend, setInterviewTrend] = useState<InterviewTrendPoint[]>([])
  const [trendLoading, setTrendLoading] = useState(true)
  const [granularity, setGranularity] = useState<Granularity>('scan')

  useEffect(() => {
    let cancelled = false
    historyService
      .getInterviewHistory()
      .then((interviews) => {
        if (cancelled) return
        const trend = interviews
          .filter((s) => s.average_score != null)
          .slice()
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
          .map((s) => ({
            date: formatShortDate(s.created_at),
            label: `${s.seniority} ${s.role}`,
            score: s.average_score as number,
          }))
        setInterviewTrend(trend)
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : 'Failed to load your interview trend.')
      })
      .finally(() => {
        if (!cancelled) setTrendLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const loading = homeLoading || !data

  const readiness = useMemo(() => computeReadinessScore(data), [data])

  const atsChartData = useMemo(() => {
    if (!data) return []
    if (granularity === 'scan') {
      return data.analytics.ats_history.map((p) => ({ x: formatShortDate(p.date), full: p.label, score: p.score }))
    }
    const source = granularity === 'week' ? data.analytics.weekly_progress : data.analytics.monthly_progress
    return source.map((p) => ({ x: p.period, full: p.period, score: p.score }))
  }, [data, granularity])

  const atsHistory = data?.analytics.ats_history ?? []
  const funnel = data?.analytics.funnel

  const milestones = useMemo(() => (data ? buildMilestones(data) : []), [data])
  const currentIndex = useMemo(() => {
    const idx = milestones.findIndex((m) => !m.complete)
    return idx === -1 ? milestones.length - 1 : idx
  }, [milestones])
  const completeCount = milestones.filter((m) => m.complete).length

  const nextStepCopy = useMemo(() => {
    if (!data) return null
    if (data.resume.resumes_analyzed === 0) return 'Analyze a resume to establish your baseline score.'
    if (data.interview.completed_sessions === 0) return 'Complete a mock interview to round out your readiness score.'
    if (data.applications.total === 0) return 'Track an application to start building your pipeline.'
    if (data.analytics.funnel.reached_interviewing === 0) return 'Keep applying — none of your tracked applications have reached an interview stage yet.'
    return "You've hit every milestone this page tracks — keep your resume and interview scores fresh."
  }, [data])

  if (loading) {
    return (
      <div className="grid gap-[18px]">
        <Skeleton className="h-[150px] w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <div className="grid gap-3 lg:grid-cols-2">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-[18px]">
      {/* Readiness hero */}
      <Card className="flex flex-col gap-4 overflow-hidden rounded-xl bg-gradient-to-br from-[#312e81] to-primary p-[23px] text-white sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-[19px]">
          <ConicRing
            value={readiness}
            size={92}
            toneClassName={scoreToneClass(getScoreTone(readiness))}
            holeClassName="bg-primary"
          >
            <span className="font-heading text-xl font-extrabold text-white">{readiness}</span>
          </ConicRing>
          <div>
            <AiBadge label="CAREER READINESS" />
            <h2 className="mt-1.5 font-heading text-[21px] font-bold text-white">{readinessTier(readiness)}</h2>
            <p className="mt-1 max-w-[510px] text-[10px] text-[#c7d2fe]">{nextStepCopy}</p>
          </div>
        </div>
        <div className="flex divide-x divide-white/15 self-stretch sm:self-auto">
          <div className="grid content-center gap-0.5 px-4 first:pl-0">
            <strong className="font-heading text-[15px] font-extrabold text-white">{data!.resume.resumes_analyzed}</strong>
            <small className="text-[8px] text-[#c7d2fe]">resumes analyzed</small>
          </div>
          <div className="grid content-center gap-0.5 px-4">
            <strong className="font-heading text-[15px] font-extrabold text-white">{data!.interview.completed_sessions}</strong>
            <small className="text-[8px] text-[#c7d2fe]">mock interviews</small>
          </div>
          <div className="grid content-center gap-0.5 px-4">
            <strong className="font-heading text-[15px] font-extrabold text-white">{data!.applications.offers}</strong>
            <small className="text-[8px] text-[#c7d2fe]">offers received</small>
          </div>
        </div>
      </Card>

      {/* Milestone roadmap */}
      <Card className="p-[19px]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-heading text-[15px] font-bold text-foreground">Your path to offer</h3>
            <p className="mt-1 text-[10px] text-muted-foreground">Each stage builds on the work before it.</p>
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {completeCount} of {milestones.length} complete
          </span>
        </div>
        <div className="mt-[23px] grid grid-cols-2 gap-y-6 sm:grid-cols-4">
          {milestones.map((milestone, index) => (
            <div key={milestone.label} className="relative grid justify-items-center gap-1.5 px-2 text-center">
              {index > 0 && (
                <span
                  className={cn(
                    'absolute right-1/2 top-4 h-0.5 w-full',
                    // Real usage isn't strictly sequential (e.g. tracking an
                    // application before ever running a mock interview), so
                    // this colors purely on whether the stage it's leaving
                    // is actually done — never on distance from "current",
                    // which broke visually the moment a later stage finished
                    // before an earlier one did.
                    milestones[index - 1].complete ? 'bg-success' : 'bg-border'
                  )}
                />
              )}
              <span
                className={cn(
                  'relative z-[1] grid h-[33px] w-[33px] place-items-center rounded-full border-2 font-heading text-[10px] font-extrabold',
                  milestone.complete
                    ? 'border-success bg-success text-white'
                    : index === currentIndex
                      ? 'border-primary bg-card text-primary shadow-[0_0_0_5px_hsl(var(--secondary))]'
                      : 'border-border bg-card text-muted-foreground'
                )}
              >
                {milestone.complete ? <Check size={17} /> : index + 1}
              </span>
              <strong className="text-[9px] text-foreground">{milestone.label}</strong>
              <small className="text-[8px] leading-snug text-muted-foreground">{milestone.description}</small>
            </div>
          ))}
        </div>
      </Card>

      {/* ATS + Interview trend charts, in Figma's weekly-goals / skill-growth grid slots */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="p-[18px]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-heading text-[15px] font-bold text-foreground">Resume ATS evolution</h3>
              <p className="mt-1 text-[9px] text-muted-foreground">
                ATS score {granularity === 'scan' ? 'across every scan' : granularity === 'week' ? 'by week' : 'by month'}
              </p>
            </div>
            <div className="flex gap-1">
              {(['scan', 'week', 'month'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGranularity(g)}
                  className={cn(
                    'rounded-md px-2 py-1 text-[9px] font-semibold capitalize transition-colors',
                    granularity === g ? 'bg-secondary text-primary' : 'text-muted-foreground hover:bg-accent'
                  )}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2.5 h-[200px]">
            {atsChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={atsChartData} margin={{ top: 10, right: 5, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="atsGradProgress" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--success))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--success))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="x" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={{ fontSize: 9 }} />
                  <RechartsTooltip
                    contentStyle={{ borderRadius: 10, border: '1px solid hsl(var(--border))', fontSize: 12 }}
                    formatter={(value: number) => [`${value}%`, 'ATS score']}
                  />
                  <Area type="monotone" dataKey="score" stroke="hsl(var(--success))" strokeWidth={2.5} fill="url(#atsGradProgress)" dot={{ r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2.5 text-center">
                <p className="text-[10px] text-muted-foreground">No resume scans yet.</p>
                <Button size="sm" variant="outline" asChild>
                  <Link to="/resume/upload">Analyze resume</Link>
                </Button>
              </div>
            )}
          </div>
        </Card>

        <Card className="p-[18px]">
          <div>
            <h3 className="font-heading text-[15px] font-bold text-foreground">Interview score trajectory</h3>
            <p className="mt-1 text-[9px] text-muted-foreground">Average score across each completed mock interview</p>
          </div>
          <div className="mt-2.5 h-[200px]">
            {trendLoading ? (
              <Skeleton className="h-full w-full" />
            ) : interviewTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={interviewTrend} margin={{ top: 10, right: 5, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 10]} tickLine={false} axisLine={false} tick={{ fontSize: 9 }} />
                  <RechartsTooltip
                    contentStyle={{ borderRadius: 10, border: '1px solid hsl(var(--border))', fontSize: 12 }}
                    labelFormatter={(_l, payload) => payload?.[0]?.payload?.label ?? _l}
                    formatter={(value: number) => [`${value}/10`, 'Score']}
                  />
                  <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '4px' }} />
                  <Line type="monotone" dataKey="score" name="Interview score" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2.5 text-center">
                <p className="text-[10px] text-muted-foreground">No completed interview sessions yet.</p>
                <Button size="sm" variant="outline" asChild>
                  <Link to="/interview/setup">Practice interview</Link>
                </Button>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Consistency — Figma's streak heatmap has no backing data (no
          per-day activity log anywhere in the schema, same finding as the
          Dashboard's own streak card); a real CTA replaces it instead of a
          fabricated calendar. */}
      <Card className="flex flex-col items-center gap-3 p-[19px] text-center sm:flex-row sm:justify-between sm:text-left">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-coral-tint text-coral">
            <Flame size={18} />
          </span>
          <div>
            <h3 className="font-heading text-[13px] font-bold text-foreground">Your consistency</h3>
            <p className="mt-0.5 text-[9px] text-muted-foreground">
              Day-by-day activity tracking isn't available yet — practice regularly to build your scores instead.
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" asChild className="shrink-0">
          <Link to="/interview/setup">Practice now</Link>
        </Button>
      </Card>

      {/* Pipeline funnel */}
      {funnel && funnel.total_tracked > 0 && (
        <Card className="p-[19px]">
          <h3 className="font-heading text-[15px] font-bold text-foreground">Application pipeline funnel</h3>
          <p className="mt-1 text-[10px] text-muted-foreground">
            How far your {funnel.total_tracked} tracked application{funnel.total_tracked === 1 ? '' : 's'} made it
          </p>
          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <div className="rounded-lg border border-border p-3.5 text-center">
              <p className="font-heading text-xl font-extrabold text-foreground">{funnel.reached_applied}</p>
              <p className="mt-1 text-[9px] text-muted-foreground">Applied</p>
            </div>
            <div className="rounded-lg border border-border p-3.5 text-center">
              <p className="font-heading text-xl font-extrabold text-foreground">{funnel.reached_interviewing}</p>
              <p className="mt-1 text-[9px] text-muted-foreground">
                Reached interview{funnel.interview_rate != null ? ` · ${funnel.interview_rate}%` : ''}
              </p>
            </div>
            <div className="rounded-lg border border-border p-3.5 text-center">
              <p className="font-heading text-xl font-extrabold text-foreground">{funnel.reached_offer}</p>
              <p className="mt-1 text-[9px] text-muted-foreground">
                Reached offer{funnel.offer_rate != null ? ` · ${funnel.offer_rate}%` : ''}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Insights */}
      <div className="grid gap-3">
        <div>
          <h3 className="font-heading text-[15px] font-bold text-foreground">Insights</h3>
          <p className="mt-0.5 text-[10px] text-muted-foreground">Observations drawn directly from your own activity</p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Card className="p-[16px]">
            <div className="flex items-center gap-2 text-success">
              <FileText className="h-4 w-4" />
              <h4 className="font-heading text-[12px] font-bold">Resume trend</h4>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              {atsHistory.length >= 2
                ? `Your ATS score moved from ${atsHistory[0].score}% to ${atsHistory[atsHistory.length - 1].score}% across ${atsHistory.length} scans.`
                : atsHistory.length === 1
                  ? `You've completed one resume scan so far, scoring ${atsHistory[0].score}%. Scan again after edits to start a trend.`
                  : "You haven't scanned a resume yet — upload one to start tracking your ATS score."}
            </p>
          </Card>

          <Card className="p-[16px]">
            <div className="flex items-center gap-2 text-primary">
              <TrendingUp className="h-4 w-4" />
              <h4 className="font-heading text-[12px] font-bold">Interview performance</h4>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              {data!.interview.completed_sessions > 0
                ? `You've completed ${data!.interview.completed_sessions} mock interview${data!.interview.completed_sessions === 1 ? '' : 's'}, averaging ${data!.interview.average_score}/10.${
                    data!.interview.latest_report
                      ? ` Most recent: ${data!.interview.latest_report.role} — ${data!.interview.latest_report.overall_score}/10 (${data!.interview.latest_report.readiness_band}).`
                      : ''
                  }`
                : "You haven't completed a mock interview yet — practice a round to get a readiness score."}
            </p>
          </Card>

          <Card className="p-[16px]">
            <div className="flex items-center gap-2 text-warning">
              <Sparkles className="h-4 w-4" />
              <h4 className="font-heading text-[12px] font-bold">Skills to close</h4>
            </div>
            <div className="mt-2">
              {data!.resume.suggested_improvements.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {data!.resume.suggested_improvements.map((skill) => (
                    <Badge key={skill} variant="outline" className="text-[9px]">
                      {skill}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  No outstanding skill gaps flagged from your latest scan.
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
