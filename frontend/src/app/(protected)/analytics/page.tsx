'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import CountUp from 'react-countup';
import { TrendingUp, Target, FileSearch, Trophy } from 'lucide-react';
import { TrendChart } from '@/components/charts/TrendChart';
import { getAnalyticsSummary, type AnalyticsSummary } from '@/lib/apiClient';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';

const ANALYTICS_KEY = ['analytics', 'summary'] as const;

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

interface TrendPoint {
  date: string;
  score: number;
  label: string;
  quantified?: number;
}

/** Conversion step. Width is relative to the widest stage, not to 100%. */
function FunnelRow({
  label,
  count,
  widest,
  rate,
}: {
  label: string;
  count: number;
  widest: number;
  rate?: number | null;
}) {
  const width = widest > 0 ? Math.max(2, (count / widest) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-xs text-(--color-ink-subtle)">{label}</span>
        <span className="flex items-baseline gap-2">
          {rate !== undefined && rate !== null && (
            <span className="font-mono text-[10px] text-(--color-ink-faint)">{rate}%</span>
          )}
          <span className="font-mono text-xs tabular-nums text-(--color-ink)">{count}</span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--color-canvas-line)' }}>
        <div className="h-full rounded-full" style={{ width: `${width}%`, background: 'var(--color-ink)' }} />
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  suffix = '',
  prefix = '',
  sub,
  index,
}: {
  icon: React.ElementType;
  label: string;
  value: number | null;
  suffix?: string;
  prefix?: string;
  sub: string;
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07 }}
      className="rounded-2xl border border-(--color-canvas-line-soft) bg-(--color-canvas-raise) p-5 transition-colors hover:border-(--color-canvas-line)"
    >
      <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-(--color-accent)/10">
        <Icon className="h-4 w-4 text-(--color-accent)" />
      </div>
      <div className="font-display text-xl font-bold tabular-nums text-(--color-accent)">
        {value === null ? (
          // An em dash, not 0 — "no data yet" and "scored zero" are different
          // claims, and the second one is wrong.
          <span className="text-(--color-ink-faint)">—</span>
        ) : (
          <CountUp end={value} duration={1.4} prefix={prefix} suffix={suffix} decimals={value % 1 === 0 ? 0 : 1} />
        )}
      </div>
      <div className="mt-0.5 text-xs font-medium text-(--color-ink)">{label}</div>
      <div className="mt-0.5 text-xs text-(--color-ink-faint)">{sub}</div>
    </motion.div>
  );
}

export default function AnalyticsPage() {
  const { data, isLoading, isError } = useQuery<AnalyticsSummary>({
    queryKey: ANALYTICS_KEY,
    queryFn: getAnalyticsSummary,
  });

  const trend = useMemo<TrendPoint[]>(() => {
    if (!data) return [];
    const quantifiedById = new Map(
      data.quantified_history.map((point) => [point.id, point.quantified_ratio]),
    );
    return data.ats_history.map((point) => ({
      date: shortDate(point.date),
      score: point.score,
      label: point.label,
      quantified: quantifiedById.get(point.id),
    }));
  }, [data]);

  if (isLoading) {
    return (
      <div className="max-w-6xl space-y-6">
        <Skeleton className="h-8 w-40" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[132px]" />
          ))}
        </div>
        <Skeleton className="h-[300px]" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="max-w-6xl">
        <div className="card p-6">
          <p className="text-sm text-(--color-ink-dim)">
            Could not load your analytics. Check that the API is running and try again.
          </p>
        </div>
      </div>
    );
  }

  const { funnel } = data;
  const widest = Math.max(funnel.total_tracked, 1);

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        eyebrow="Analytics"
        eyebrowIcon={TrendingUp}
        title="How your search is trending."
        description="Your own scan history and pipeline — every figure below is computed from your records."
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          icon={Target} label="Best ATS score" value={data.best_score} suffix="%"
          sub={data.scan_count > 0 ? `Across ${data.scan_count} scan${data.scan_count === 1 ? '' : 's'}` : 'No scans yet'}
          index={0}
        />
        <StatCard
          icon={TrendingUp} label="Change" value={data.score_delta}
          prefix={data.score_delta !== null && data.score_delta > 0 ? '+' : ''} suffix=" pts"
          sub={data.score_delta === null ? 'Needs two scans' : 'First scan to latest'}
          index={1}
        />
        <StatCard
          icon={FileSearch} label="Interview rate" value={funnel.interview_rate} suffix="%"
          sub={funnel.reached_applied > 0 ? `Of ${funnel.reached_applied} applied` : 'Nothing applied yet'}
          index={2}
        />
        <StatCard
          icon={Trophy} label="Offer rate" value={funnel.offer_rate} suffix="%"
          sub={funnel.reached_offer > 0 ? `${funnel.reached_offer} offer${funnel.reached_offer === 1 ? '' : 's'}` : 'No offers yet'}
          index={3}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="rounded-2xl border border-(--color-canvas-line-soft) bg-(--color-canvas-raise) p-6"
      >
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-(--color-ink)">ATS score by scan</h2>
          <p className="mt-0.5 text-xs text-(--color-ink-faint)">
            Chronological, one point per resume version you scanned.
          </p>
        </div>

        {trend.length === 0 ? (
          <p className="py-10 text-center text-sm text-(--color-ink-faint)">
            No scans yet. Analyze a resume to start tracking your trajectory.
          </p>
        ) : trend.length === 1 ? (
          <div className="py-10 text-center">
            <p className="font-display text-3xl tabular-nums text-(--color-ink)">
              {trend[0].score}
            </p>
            <p className="mt-1 text-xs text-(--color-ink-faint)">
              {trend[0].label} · one scan so far, not yet a trend
            </p>
          </div>
        ) : (
          <TrendChart
            id="analytics-ats-trend"
            points={trend}
            fixedScale
            height={240}
            summary={`ATS score across ${trend.length} scans, from ${trend[0].score} on ${trend[0].label} to ${trend[trend.length - 1].score} on ${trend[trend.length - 1].label}.`}
          />
        )}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="rounded-2xl border border-(--color-canvas-line-soft) bg-(--color-canvas-raise) p-6"
      >
        <div className="mb-5">
          <h2 className="text-sm font-semibold text-(--color-ink)">Pipeline conversion</h2>
          <p className="mt-0.5 text-xs text-(--color-ink-faint)">
            Counted as &ldquo;reached at least this stage&rdquo;, so a role now at interview still
            counts as applied.
          </p>
        </div>

        {funnel.total_tracked === 0 ? (
          <p className="py-8 text-center text-sm text-(--color-ink-faint)">
            Nothing tracked yet. Save a role to your pipeline to see conversion rates.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-3.5">
              <FunnelRow label="Tracked" count={funnel.total_tracked} widest={widest} />
              <FunnelRow label="Applied" count={funnel.reached_applied} widest={widest} />
              <FunnelRow
                label="Interviewing"
                count={funnel.reached_interviewing}
                widest={widest}
                rate={funnel.interview_rate}
              />
              <FunnelRow
                label="Offer"
                count={funnel.reached_offer}
                widest={widest}
                rate={funnel.offer_rate}
              />
            </div>
            <p className="mt-4 text-[10px] leading-relaxed text-(--color-ink-faint)">
              Rates are out of applications actually sent, not every saved role. A rejection
              doesn&apos;t record which stage it happened at, so the interview rate is a floor.
            </p>
          </>
        )}
      </motion.div>
    </div>
  );
}
