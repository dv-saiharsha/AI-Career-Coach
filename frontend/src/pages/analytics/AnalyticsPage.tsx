import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BarChart3, Minus, TrendingDown, TrendingUp } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useApiData } from '@/hooks/useApiData'
import { analyticsService } from '@/services/analyticsService'
import { cn } from '@/lib/utils'

const TOOLTIP_STYLE = {
  borderRadius: 10,
  border: '1px solid hsl(var(--border))',
  fontSize: 12,
} as const

const AXIS_TICK = { fill: 'hsl(var(--muted-foreground))', fontSize: 9 }

// Figma's donut uses 4 arbitrary "source" colors it has no real data behind
// (see the deviation note below) — reusing the same palette on the real
// per-stage breakdown instead so the page still reads as one system.
const STAGE_DONUT_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--coral))',
  'hsl(var(--chart-indigo-soft))',
  'hsl(var(--success))',
  'hsl(var(--warning))',
  'hsl(var(--chart-indigo-tint-strong))',
]

const STAGE_ORDER = [
  'viewed',
  'saved',
  'applied',
  'recruiter_contacted',
  'recruiter_screening',
  'online_assessment',
  'technical_interview',
  'manager_interview',
  'final_interview',
  'offer',
  'accepted',
  'rejected',
  'withdrawn',
] as const

function humanizeStage(stage: string): string {
  return stage
    .split('_')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ')
}

function shortDate(iso: string | null): string {
  if (!iso) return ''
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatDelta(delta: number | null): string {
  if (delta === null) return '—'
  return `${delta > 0 ? '+' : ''}${delta} pts`
}

function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${rate}%`
}

function formatScore(score: number | null): string {
  return score === null ? '—' : `${score}%`
}

function TrendIcon({ direction }: { direction: 'up' | 'down' | 'flat' }) {
  if (direction === 'up') return <TrendingUp size={11} />
  if (direction === 'down') return <TrendingDown size={11} />
  return <Minus size={11} />
}

interface KpiCardProps {
  label: string
  value: string
  trendLabel: string
  direction: 'up' | 'down' | 'flat'
}

function KpiCard({ label, value, trendLabel, direction }: KpiCardProps) {
  return (
    <Card className="grid p-[17px]">
      <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground">{label}</span>
      <strong className="my-1.5 font-heading text-[26px] font-extrabold text-foreground">{value}</strong>
      <span
        className={cn(
          'flex items-center gap-1 text-[8px] font-semibold',
          direction === 'up' && 'text-success',
          direction === 'down' && 'text-destructive',
          direction === 'flat' && 'text-muted-foreground'
        )}
      >
        <TrendIcon direction={direction} />
        {trendLabel}
      </span>
    </Card>
  )
}

function ChartCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card className={cn('min-w-0 p-[19px]', className)}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-heading text-[15px] font-bold text-foreground">{title}</h3>
        {action}
      </div>
      {description && <p className="mt-[3px] text-[8px] text-muted-foreground">{description}</p>}
      {children}
    </Card>
  )
}

function StatusPill({ tone, children }: { tone: 'success' | 'warning' | 'neutral'; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-[7px] py-1 text-[8px] font-bold',
        tone === 'success' && 'bg-success-tint text-success',
        tone === 'warning' && 'bg-warning-tint text-warning',
        tone === 'neutral' && 'bg-secondary text-secondary-foreground'
      )}
    >
      {children}
    </span>
  )
}

function ChartEmptyState({ message, ctaLabel, ctaTo }: { message: string; ctaLabel?: string; ctaTo?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 py-8 text-center">
      <p className="max-w-xs text-xs text-muted-foreground">{message}</p>
      {ctaLabel && ctaTo && (
        <Button variant="outline" size="sm" asChild>
          <Link to={ctaTo}>
            {ctaLabel} <ArrowRight size={14} />
          </Link>
        </Button>
      )}
    </div>
  )
}

function AnalyticsSkeleton() {
  return (
    <div className="grid gap-[19px]">
      <Skeleton className="h-14 w-72" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[104px] rounded-lg" />
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Skeleton className="h-[280px] rounded-lg" />
        <Skeleton className="h-[280px] rounded-lg" />
      </div>
    </div>
  )
}

export function AnalyticsPage() {
  const { data: summary, loading, error } = useApiData(analyticsService.getSummary)
  const [donutHover, setDonutHover] = useState<string | null>(null)

  const atsTrend = useMemo(
    () => (summary?.ats_history ?? []).map((point) => ({ ...point, dateLabel: shortDate(point.date) })),
    [summary]
  )
  const qualityTrend = useMemo(
    () => (summary?.quantified_history ?? []).map((point) => ({ ...point, dateLabel: shortDate(point.date) })),
    [summary]
  )
  const stageBreakdown = useMemo(() => {
    if (!summary) return []
    return STAGE_ORDER.map((stage) => ({ stage, count: summary.funnel.by_stage[stage] ?? 0 })).filter(
      (entry) => entry.count > 0
    )
  }, [summary])

  if (loading) return <AnalyticsSkeleton />

  if (error || !summary) {
    return (
      <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <BarChart3 className="h-8 w-8 text-muted-foreground" />
        <p className="max-w-sm text-sm text-muted-foreground">Could not load your analytics. Check your connection and try again.</p>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </Card>
    )
  }

  const { funnel } = summary
  const funnelData = [
    { stage: 'Tracked', count: funnel.total_tracked },
    { stage: 'Applied', count: funnel.reached_applied },
    { stage: 'Interviewing', count: funnel.reached_interviewing },
    { stage: 'Offer', count: funnel.reached_offer },
  ]
  const funnelHealthy = funnel.interview_rate != null && funnel.interview_rate >= 30

  const scoreDirection = summary.score_delta === null || summary.score_delta === 0 ? 'flat' : summary.score_delta > 0 ? 'up' : 'down'
  const stageTotal = stageBreakdown.reduce((sum, entry) => sum + entry.count, 0)

  return (
    <div className="grid gap-[19px]">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-heading text-2xl font-bold text-foreground">Career analytics</h2>
          <p className="mt-1 text-[10px] text-muted-foreground">
            See what&rsquo;s working across your preparation and applications.
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 font-mono text-xs text-muted-foreground">
          <BarChart3 size={13} />
          {summary.scan_count} scan{summary.scan_count === 1 ? '' : 's'} tracked
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Best ATS score"
          value={formatScore(summary.best_score)}
          trendLabel={summary.scan_count > 0 ? `Across ${summary.scan_count} scan${summary.scan_count === 1 ? '' : 's'}` : 'No scans yet'}
          direction="flat"
        />
        <KpiCard
          label="Score change"
          value={formatDelta(summary.score_delta)}
          trendLabel={summary.score_delta === null ? (summary.scan_count === 1 ? 'Needs a second scan' : 'No scans yet') : 'First scan to latest'}
          direction={scoreDirection}
        />
        <KpiCard
          label="Interview rate"
          value={formatRate(funnel.interview_rate)}
          trendLabel={funnel.reached_applied > 0 ? `Of ${funnel.reached_applied} applied` : 'Nothing applied yet'}
          direction="flat"
        />
        <KpiCard
          label="Offer rate"
          value={formatRate(funnel.offer_rate)}
          trendLabel={funnel.reached_offer > 0 ? `${funnel.reached_offer} offer${funnel.reached_offer === 1 ? '' : 's'} reached` : 'No offers yet'}
          direction="flat"
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard
          title="Application funnel"
          description="Conversion from tracked roles to offers."
          action={
            funnel.total_tracked > 0 ? (
              <StatusPill tone={funnelHealthy ? 'success' : 'warning'}>
                <TrendingUp size={11} /> {funnelHealthy ? 'Healthy' : 'Needs attention'}
              </StatusPill>
            ) : undefined
          }
        >
          <div className="mt-2 h-[220px]">
            {funnel.total_tracked === 0 ? (
              <ChartEmptyState
                message="Nothing tracked yet. Save a role to your pipeline to see conversion here."
                ctaLabel="Go to pipeline"
                ctaTo="/applications"
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnelData} layout="vertical" margin={{ left: 12, right: 30 }}>
                  <CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis type="number" hide allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="stage"
                    axisLine={false}
                    tickLine={false}
                    width={80}
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                  />
                  <RechartsTooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 5, 5, 0]} barSize={17} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </ChartCard>

        <ChartCard
          title="Resume score trend"
          description="ATS score across saved versions."
          action={summary.score_delta != null && summary.score_delta > 0 ? <StatusPill tone="success">+{summary.score_delta} points</StatusPill> : undefined}
        >
          <div className="mt-2 h-[220px]">
            {atsTrend.length < 2 ? (
              atsTrend.length === 1 ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <div className="text-4xl font-extrabold text-foreground">{atsTrend[0].score}%</div>
                  <p className="mt-2 text-xs text-muted-foreground">{atsTrend[0].label} &middot; one scan so far</p>
                </div>
              ) : (
                <ChartEmptyState
                  message="Not enough data yet. Analyze a resume to start tracking this trend."
                  ctaLabel="Analyze a resume"
                  ctaTo="/resume/upload"
                />
              )
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={atsTrend} margin={{ top: 12, right: 12, left: -20 }}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="dateLabel" axisLine={false} tickLine={false} tick={AXIS_TICK} />
                  <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={AXIS_TICK} />
                  <RechartsTooltip contentStyle={TOOLTIP_STYLE} formatter={(value: number) => [`${value}%`, 'ATS score']} />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2.5}
                    dot={{ fill: 'hsl(var(--primary))', r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </ChartCard>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Figma's "Interview score trend" has no real data behind it — no
            interview-score history exists anywhere in the schema. This slot
            shows the real Resume Quality diagnostic (quantified-bullet ratio
            + X-Y-Z structure grade) instead, since that IS real and already
            computed by the backend. */}
        <ChartCard title="Resume quality over time" description="Quantified-bullet coverage and structure grade per scan.">
          <div className="mt-2 h-[220px]">
            {qualityTrend.length < 2 ? (
              qualityTrend.length === 1 ? (
                <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
                  <div className="text-3xl font-extrabold text-primary">{qualityTrend[0].quantified_ratio}%</div>
                  <p className="text-xs text-muted-foreground">Bullets with a real metric &middot; one scan so far</p>
                </div>
              ) : (
                <ChartEmptyState message="No quality diagnostics yet. Your next resume scan will start this trend." />
              )
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={qualityTrend} margin={{ top: 12, right: 12, left: -20 }}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="dateLabel" axisLine={false} tickLine={false} tick={AXIS_TICK} />
                  <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={AXIS_TICK} />
                  <RechartsTooltip contentStyle={TOOLTIP_STYLE} />
                  <Line
                    type="monotone"
                    dataKey="quantified_ratio"
                    name="Quantified bullets"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2.5}
                    dot={{ fill: 'hsl(var(--primary))', r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="impact_rating"
                    name="Impact grade"
                    stroke="hsl(var(--coral))"
                    strokeWidth={2.5}
                    dot={{ fill: 'hsl(var(--coral))', r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </ChartCard>

        {/* Figma's "Applications by source" also has no real data behind it
            — nothing tracks where an application came from. This shows the
            real current-status breakdown instead (same numbers the old page
            listed as badges), in the donut slot Figma reserves here. */}
        <ChartCard title="Applications by stage" description="Where your tracked applications sit right now.">
          {stageBreakdown.length === 0 ? (
            <div className="mt-2 h-[220px]">
              <ChartEmptyState
                message="Nothing tracked yet. Save a role to your pipeline to see this breakdown."
                ctaLabel="Go to pipeline"
                ctaTo="/applications"
              />
            </div>
          ) : (
            <div className="mt-2 grid grid-cols-1 items-center gap-4 sm:grid-cols-[1.1fr_0.9fr]">
              <div className="relative h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={stageBreakdown}
                      dataKey="count"
                      nameKey="stage"
                      innerRadius={55}
                      outerRadius={76}
                      paddingAngle={3}
                      onMouseEnter={(_, index) => setDonutHover(stageBreakdown[index].stage)}
                      onMouseLeave={() => setDonutHover(null)}
                    >
                      {stageBreakdown.map((entry, index) => (
                        <Cell key={entry.stage} fill={STAGE_DONUT_COLORS[index % STAGE_DONUT_COLORS.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip contentStyle={TOOLTIP_STYLE} formatter={(value: number, name) => [value, humanizeStage(String(name))]} />
                  </PieChart>
                </ResponsiveContainer>
                <span className="pointer-events-none absolute inset-0 grid place-content-center text-center">
                  <strong className="font-heading text-[19px] font-extrabold text-foreground">
                    {donutHover ? stageBreakdown.find((e) => e.stage === donutHover)?.count : stageTotal}
                  </strong>
                  <small className="text-[7px] text-muted-foreground">
                    {donutHover ? humanizeStage(donutHover) : 'applications'}
                  </small>
                </span>
              </div>
              <div className="grid gap-2.5">
                {stageBreakdown.map((entry, index) => (
                  <span key={entry.stage} className="grid grid-cols-[7px_1fr_auto] items-center gap-1.5 text-[8px] text-muted-foreground">
                    <i
                      className="h-[7px] w-[7px] rounded-[2px]"
                      style={{ background: STAGE_DONUT_COLORS[index % STAGE_DONUT_COLORS.length] }}
                    />
                    {humanizeStage(entry.stage)}
                    <strong className="text-[8px] text-foreground">
                      {stageTotal > 0 ? Math.round((entry.count / stageTotal) * 100) : 0}%
                    </strong>
                  </span>
                ))}
              </div>
            </div>
          )}
        </ChartCard>
      </div>

      <Card className="overflow-x-auto p-[18px]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-heading text-[15px] font-bold text-foreground">Your resume scans</h3>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Every version you&rsquo;ve analyzed, most recent first.</p>
          </div>
          <Button variant="ghost" size="sm" asChild className="h-auto p-0 text-xs text-primary">
            <Link to="/history">View all</Link>
          </Button>
        </div>
        {atsTrend.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">No resume scans yet.</p>
        ) : (
          <div className="mt-3 min-w-[480px]">
            <div className="grid min-h-[36px] grid-cols-[2fr_1fr_1fr] gap-2.5 text-[7px] font-extrabold uppercase tracking-[0.05em] text-muted-foreground">
              <span>Resume version</span>
              <span>ATS score</span>
              <span>Scanned</span>
            </div>
            {[...atsTrend].reverse().map((scan) => (
              <div
                key={scan.id}
                className="grid min-h-[49px] grid-cols-[2fr_1fr_1fr] items-center gap-2.5 border-t border-border text-[9px] text-muted-foreground"
              >
                <strong className="truncate text-foreground">{scan.label}</strong>
                <span>
                  <StatusPill tone={scan.score >= 75 ? 'success' : scan.score >= 50 ? 'warning' : 'neutral'}>
                    {scan.score}
                  </StatusPill>
                </span>
                <span>{scan.dateLabel}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
