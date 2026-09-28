import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Briefcase,
  FileSearch,
  Flame,
  Gift,
  MessageSquareText,
  MoreHorizontal,
  Sparkles,
} from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ConicRing } from '@/components/shared/ConicRing'
import { useAuth } from '@/context/AuthContext'
import { useDashboardHome } from '@/hooks/useDashboardHome'
import { computeReadinessScore } from '@/lib/readiness'
import { getScoreTone, scoreToneClass } from '@/lib/scoreTone'
import { buildFunnelStages } from '@/lib/funnel'
import { STAGE_LABELS } from '@/types/applications'
import { cn } from '@/lib/utils'

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function todayLabel(): string {
  return new Date()
    .toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    .toUpperCase()
}

function readinessLabel(score: number): string {
  if (score >= 75) return 'On track'
  if (score >= 45) return 'Building momentum'
  return 'Just getting started'
}

const COMPANY_TONES = ['bg-primary text-primary-foreground', 'bg-coral text-white', 'bg-foreground text-background']

function companyTone(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash + name.charCodeAt(i)) % COMPANY_TONES.length
  return COMPANY_TONES[hash]
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-[19px]">
      <div className="flex items-center justify-between">
        <div className="grid gap-2">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-7 w-56" />
        </div>
        <Skeleton className="h-[74px] w-[280px] rounded-lg" />
      </div>
      <div className="grid grid-cols-1 gap-[13px] sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[88px] rounded-lg" />
        ))}
      </div>
      <div className="grid gap-[13px] lg:grid-cols-[1.17fr_0.83fr]">
        <Skeleton className="h-[320px] rounded-lg" />
        <Skeleton className="h-[320px] rounded-lg" />
      </div>
    </div>
  )
}

export function DashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { data, loading } = useDashboardHome()
  const readiness = computeReadinessScore(data)
  const firstName = user?.fullName?.split(' ')[0] || user?.email?.split('@')[0] || 'there'

  const funnelStages = useMemo(
    () => (data ? buildFunnelStages(data.analytics.funnel) : []),
    [data]
  )

  if (loading || !data) return <DashboardSkeleton />

  const kpis = [
    {
      label: 'Resume score',
      icon: FileSearch,
      tone: 'text-primary bg-secondary',
      value: data.resume.latest_ats_score != null ? `${data.resume.latest_ats_score}` : '—',
      suffix: '/100',
      trend:
        data.resume.resumes_analyzed > 0
          ? `Best: ${data.resume.best_ats_score}%`
          : 'No resume scanned yet',
    },
    {
      label: 'Interview average',
      icon: MessageSquareText,
      tone: 'text-coral bg-coral-tint',
      value: data.interview.average_score != null ? `${data.interview.average_score}` : '—',
      suffix: '/10',
      trend:
        data.interview.completed_sessions > 0
          ? `${data.interview.completed_sessions} session${data.interview.completed_sessions === 1 ? '' : 's'} completed`
          : 'No sessions yet',
    },
    {
      label: 'Active applications',
      icon: Briefcase,
      tone: 'text-warning bg-warning-tint',
      value: `${data.applications.active}`,
      suffix: '',
      trend: `${data.applications.total} tracked total`,
    },
    {
      label: 'Offers received',
      icon: Gift,
      tone: 'text-success bg-success-tint',
      value: `${data.applications.offers}`,
      suffix: '',
      trend: data.applications.offers > 0 ? 'Compare your offers' : 'Keep applying to see offers here',
    },
  ]

  return (
    <div className="grid gap-[19px]">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
            {todayLabel()}
          </span>
          <h2 className="mt-1 font-heading text-2xl font-bold text-foreground">
            {greeting()}, {firstName}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            You&rsquo;re building strong momentum. Here&rsquo;s where to focus today.
          </p>
        </div>
        <Card className="flex min-w-[280px] items-center gap-[11px] p-[12px_12px_12px_15px]">
          <ConicRing value={readiness} size={50} toneClassName={scoreToneClass(getScoreTone(readiness))}>
            <span className="font-heading text-sm font-bold text-foreground">{readiness}</span>
          </ConicRing>
          <div className="grid flex-1">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
              Career readiness
            </span>
            <strong className="mt-0.5 font-heading text-[13px] font-bold text-foreground">
              {readinessLabel(readiness)}
            </strong>
            <small className="mt-0.5 text-[9px] text-success">
              {data.resume.resumes_analyzed} scans &middot; {data.interview.completed_sessions} sessions
            </small>
          </div>
          <Button variant="ghost" size="icon" onClick={() => navigate('/progress')} aria-label="View progress">
            <ArrowRight size={18} />
          </Button>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-[13px] sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="flex min-w-0 items-start gap-[13px] p-4">
            <div className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-[9px]', kpi.tone)}>
              <kpi.icon size={18} />
            </div>
            <div className="grid min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-[0.05em] text-muted-foreground">
                {kpi.label}
              </span>
              <p className="mt-0.5 text-2xl font-extrabold leading-none text-foreground">
                {kpi.value}
                <small className="ml-0.5 text-[11px] font-medium text-muted-foreground">{kpi.suffix}</small>
              </p>
              <span className="mt-1 whitespace-nowrap text-[9px] text-muted-foreground">{kpi.trend}</span>
            </div>
          </Card>
        ))}
      </section>

      <section className="grid gap-[13px] lg:grid-cols-[1.17fr_0.83fr]">
        <Card className="relative overflow-hidden p-[19px]">
          <div className="pointer-events-none absolute -right-[50px] -top-[90px] h-[180px] w-[180px] rounded-full bg-coral-tint blur-[20px]" />
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <span className="inline-flex w-fit items-center gap-1 rounded-full bg-coral-tint px-[7px] py-1 text-[9px] font-extrabold uppercase tracking-[0.07em] text-coral-foreground">
                <Sparkles size={12} strokeWidth={2.4} /> AI recommended
              </span>
              <h3 className="mt-1 font-heading text-[15px] font-bold text-foreground">Your Next Best Actions</h3>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Prioritized from your goals and activity.</p>
            </div>
            <Sparkles className="text-coral" size={24} />
          </div>
          <div className="relative mt-[14px] grid border-t border-border">
            {data.next_actions.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                No recommendations yet — analyze a resume or track an application to get started.
              </p>
            ) : (
              data.next_actions.map((action, index) => (
                <button
                  key={action.key}
                  onClick={() => navigate(action.href)}
                  className="grid min-h-[67px] grid-cols-[32px_1fr_22px] items-center gap-2 border-b border-border py-2.5 text-left last:border-b-0 hover:bg-background"
                >
                  <span className="font-heading text-[11px] font-bold text-muted-foreground">
                    0{index + 1}
                  </span>
                  <span className="grid min-w-0">
                    <small className="text-[8px] font-extrabold uppercase tracking-[0.05em] text-coral">
                      {action.priority}
                    </small>
                    <strong className="mt-0.5 truncate text-[11px] text-foreground">{action.label}</strong>
                    <p className="mt-0.5 truncate text-[9px] text-muted-foreground">{action.description}</p>
                  </span>
                  <ArrowRight size={17} className="text-muted-foreground" />
                </button>
              ))
            )}
          </div>
        </Card>

        <Card className="min-w-0 p-[19px]">
          <div className="flex items-start justify-between gap-4">
            <h3 className="font-heading text-[15px] font-bold text-foreground">Application funnel</h3>
            <Button variant="ghost" size="sm" onClick={() => navigate('/applications')} className="h-auto p-0 text-xs">
              View pipeline <ArrowRight size={14} />
            </Button>
          </div>
          <div className="mt-3 flex items-center gap-1.5">
            <strong className="font-heading text-[19px] font-extrabold text-foreground">
              {data.analytics.funnel.interview_rate != null ? `${data.analytics.funnel.interview_rate}%` : '—'}
            </strong>
            <span className="text-[9px] text-muted-foreground">interview rate</span>
          </div>
          <div className="mt-1 h-[162px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelStages} barCategoryGap="24%">
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis
                  dataKey="stage"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                />
                <YAxis hide />
                <Tooltip
                  cursor={{ fill: 'hsl(var(--secondary))' }}
                  contentStyle={{
                    borderRadius: 10,
                    border: '1px solid hsl(var(--border))',
                    boxShadow: 'var(--shadow)',
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" radius={[6, 6, 2, 2]}>
                  {funnelStages.map((entry) => (
                    <Cell key={entry.stage} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </section>

      <section className="grid gap-[13px] lg:grid-cols-[1.45fr_0.55fr]">
        <Card className="min-w-0 p-[19px]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-heading text-[15px] font-bold text-foreground">Upcoming interviews</h3>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Applications currently at an interview stage.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate('/interview/setup')}>
              Practice now
            </Button>
          </div>
          <div className="mt-[11px] grid">
            {data.activity.upcoming_interviews.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                No applications are at an interview stage yet.
              </p>
            ) : (
              data.activity.upcoming_interviews.map((app) => (
                <div
                  key={app.id}
                  className="grid min-h-[59px] grid-cols-[38px_1fr_auto_32px] items-center gap-[9px] border-t border-border"
                >
                  <span
                    className={cn(
                      'grid h-[33px] w-[33px] place-items-center rounded-[9px] font-heading text-[13px] font-extrabold',
                      companyTone(app.company)
                    )}
                  >
                    {app.company.charAt(0).toUpperCase()}
                  </span>
                  <div className="grid min-w-0">
                    <strong className="truncate text-[10px] text-foreground">{app.company}</strong>
                    <span className="truncate text-[8px] text-muted-foreground">{app.job_title}</span>
                  </div>
                  <span className="whitespace-nowrap rounded-full bg-secondary px-[7px] py-[3px] text-[9px] font-bold text-secondary-foreground">
                    {STAGE_LABELS[app.status]}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => navigate('/applications')}
                    aria-label="View application"
                  >
                    <MoreHorizontal size={18} />
                  </Button>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="p-[19px]">
          <div className="flex items-center gap-2.5">
            <span className="grid h-[35px] w-[35px] shrink-0 place-items-center rounded-[9px] bg-coral-tint text-coral">
              <Flame size={19} />
            </span>
            <div>
              <h3 className="font-heading text-[15px] font-bold text-foreground">Practice streak</h3>
              <p className="mt-0.5 text-[9px] text-muted-foreground">Not tracked yet</p>
            </div>
          </div>
          <p className="mt-5 text-xs text-muted-foreground">
            Complete practice sessions to start building a streak and see your consistency here.
          </p>
          <Button
            variant="ghost"
            className="mt-2 h-auto p-0 text-primary"
            onClick={() => navigate('/interview/setup')}
          >
            Start practicing <ArrowRight size={15} />
          </Button>
        </Card>
      </section>

      <Card className="p-[19px]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-heading text-[15px] font-bold text-foreground">Top job matches for you</h3>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Ranked by your goals, experience, and resume strengths.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate('/jobs')}>
            Explore all matches <ArrowRight size={14} />
          </Button>
        </div>
        {data.jobs.top_matches.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            No job matches yet — analyze a resume to start matching against live postings.
          </p>
        ) : (
          <div className="mt-[14px] grid grid-cols-1 gap-[11px] sm:grid-cols-2 lg:grid-cols-3">
            {data.jobs.top_matches.slice(0, 3).map((job) => (
              <button
                key={job.id}
                onClick={() => navigate('/jobs')}
                className="grid rounded-[10px] border border-border bg-card p-3.5 text-left transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-soft"
              >
                <div className="mb-[11px] flex justify-between">
                  <span
                    className={cn(
                      'grid h-[33px] w-[33px] place-items-center rounded-[9px] font-heading text-[13px] font-extrabold',
                      companyTone(job.company)
                    )}
                  >
                    {job.company.charAt(0).toUpperCase()}
                  </span>
                  {job.match?.overallMatch != null && (
                    <span className="h-fit rounded-full bg-success-tint px-[7px] py-[5px] text-[8px] font-extrabold text-success">
                      {job.match.overallMatch}% match
                    </span>
                  )}
                </div>
                <strong className="text-[11px] text-foreground">{job.title}</strong>
                <span className="mt-[3px] text-[10px] text-muted-foreground">{job.company}</span>
                <small className="mt-1 text-[8px] text-muted-foreground">
                  {job.location} &middot; {job.workMode}
                </small>
                <div className="mt-[13px] flex items-center justify-between border-t border-border pt-2.5 text-primary">
                  <span className="inline-flex items-center gap-1 rounded-full bg-coral-tint px-[7px] py-1 text-[9px] font-extrabold uppercase tracking-[0.05em] text-coral-foreground">
                    <Sparkles size={11} /> AI match
                  </span>
                  <ArrowRight size={17} />
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
