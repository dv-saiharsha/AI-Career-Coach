'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  FileSearch, MessageSquareCode, TrendingUp, ArrowRight, Clock, Target, BarChart2, CalendarDays,
} from 'lucide-react';
import Link from 'next/link';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useAuth } from '../../../lib/AuthContext';
import { useAccentPalette } from '../../../lib/useAccentPalette';
import { ScoreRing } from '@/components/ScoreRing';
import { OnboardingModal } from '@/components/onboarding/OnboardingModal';
import { ResumeReminderDrawer } from '@/components/onboarding/ResumeReminderDrawer';
import { Skeleton } from '@/components/ui/skeleton';
import { useDashboardData } from '../../../lib/useDashboardData';
import { FreshJobsPanel } from '@/components/dashboard/FreshJobsPanel';
import { PolicyNewsPanel } from '@/components/dashboard/PolicyNewsPanel';
import { getDashboardOverview, type DashboardOverview } from '@/lib/apiClient';

const EASE = [0.22, 1, 0.36, 1] as const;

const PERFORMANCE_DATA = [
  { month: 'Jan', ats: 42, interview: 34 },
  { month: 'Feb', ats: 58, interview: 44 },
  { month: 'Mar', ats: 65, interview: 51 },
  { month: 'Apr', ats: 71, interview: 58 },
  { month: 'May', ats: 74, interview: 63 },
  { month: 'Jun', ats: 80, interview: 68 },
  { month: 'Jul', ats: 84, interview: 72 },
  { month: 'Aug', ats: 82, interview: 74 },
  { month: 'Sep', ats: 87, interview: 76 },
  { month: 'Oct', ats: 84, interview: 77 },
  { month: 'Nov', ats: 88, interview: 79 },
  { month: 'Dec', ats: 91, interview: 78 },
];

/** Splits a display value like "84%" into an animated number + suffix. */
function splitStat(value: string) {
  const match = value.match(/^(\d+(?:\.\d+)?)(.*)$/);
  if (!match) return { number: 0, suffix: value };
  return { number: parseFloat(match[1]), suffix: match[2] };
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: readonly { dataKey?: string; name?: string; value?: number; color?: string }[];
  label?: string;
}

function ChartTooltip(props: ChartTooltipProps) {
  const { active, payload, label } = props;
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line)] rounded-xl px-3.5 py-2.5 shadow-[0_12px_40px_rgba(0,0,0,0.6)] min-w-[140px]">
      <div className="text-[11px] font-medium text-[var(--color-ink-faint)] mb-2">{label}</div>
      <div className="space-y-1.5">
        {payload.map((p) => (
          <div key={p.dataKey} className="flex items-center gap-2 text-xs">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
            <span className="text-[var(--color-ink-dim)]">{p.name}</span>
            <span className="font-semibold text-[var(--color-ink)] ml-auto tabular-nums">{p.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  // Loaded separately from the core dashboard data: the news half calls an
  // external API, and a slow Federal Register should delay one panel, not the
  // whole page.
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  useEffect(() => {
    let cancelled = false;
    getDashboardOverview()
      .then((data) => { if (!cancelled) setOverview(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const { user } = useAuth();
  const palette = useAccentPalette();
  const {
    profile,
    stats,
    activity,
    loading,
    showOnboarding,
    submitError,
    finishOnboarding,
    skipOnboarding,
    showResumeReminder,
    dismissResumeReminder,
    uploadReminderResume,
  } = useDashboardData();

  // Em dash rather than 0 for absent values: a new account has no average ATS
  // score, and "0%" reads as a catastrophic result instead of an empty one.
  const show = (value: number | null | undefined, suffix = '') =>
    value === null || value === undefined ? '—' : `${value}${suffix}`;

  const STAT_CARDS = [
    {
      icon: FileSearch,
      label: 'Resumes Analyzed',
      value: show(stats?.resumes_analyzed),
      change: stats?.latest_ats_score != null ? `Latest ${stats.latest_ats_score}%` : 'No scans yet',
      color: palette.accent,
    },
    {
      icon: MessageSquareCode,
      label: 'Interview Sessions',
      value: show(stats?.interview_sessions),
      change: stats?.interview_sessions ? 'Keep practising' : 'No sessions yet',
      color: palette.accentLight,
    },
    {
      icon: Target,
      label: 'Avg ATS Score',
      value: show(stats?.avg_ats_score, '%'),
      change: stats?.resumes_analyzed ? `Across ${stats.resumes_analyzed} scan(s)` : 'Run an analysis',
      color: palette.accentLighter,
    },
    {
      icon: BarChart2,
      label: 'Interview Score',
      value: show(stats?.latest_interview_score),
      // Scores are per answer on a 0-10 rubric, so the latest session's figure
      // is the mean of its answers — not a percentage.
      change: stats?.latest_interview_score != null ? 'Latest session avg / 10' : 'No answers yet',
      color: palette.accent,
    },
  ];
  const QUICK_ACTIONS = [
    { icon: FileSearch, label: 'Analyze Resume', desc: 'Upload and get instant ATS score', href: '/resume', color: palette.accent },
    { icon: MessageSquareCode, label: 'Mock Interview', desc: 'Practice with AI coach', href: '/interview', color: palette.accentLight },
    { icon: TrendingUp, label: 'View Analytics', desc: 'Track your progress', href: '/analytics', color: palette.accentLighter },
  ];
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="space-y-7 max-w-7xl">
      {/* Onboarding interceptor. Rendered inside the dashboard rather than in
          the layout so it only blocks this page — a user mid-flow elsewhere
          isn't yanked into a modal. */}
      <OnboardingModal
        isOpen={showOnboarding}
        onComplete={finishOnboarding}
        onSkip={skipOnboarding}
        error={submitError}
      />

      {/* Follow-up for users who skipped the resume at onboarding. Non-blocking
          by design — the dashboard stays usable behind it. */}
      <ResumeReminderDrawer
        isOpen={showResumeReminder}
        onDismiss={dismissResumeReminder}
        onUpload={uploadReminderResume}
        error={submitError}
      />

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="flex flex-col md:flex-row md:items-end md:justify-between gap-4"
      >
        <div>
          <span className="section-eyebrow-violet mb-3 inline-flex">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] heartbeat-glow" />
            Dashboard
          </span>
          <h1 className="text-2xl md:text-3xl font-display font-semibold text-[var(--color-ink)] leading-tight">
            {greeting}, <span className="gradient-text-violet">{user?.firstName || 'there'}</span>
          </h1>
          <p className="text-sm text-[var(--color-ink-dim)] mt-1.5">
            Here&apos;s your career progress overview.
          </p>
          {profile && profile.target_roles.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-[var(--color-ink-faint)]">Targeting</span>
              {profile.target_roles.map((role) => (
                <span key={role} className="chip">
                  {role}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-5 shrink-0">
          {/* Headline meter: the one number the whole page is about. Falls back
              to 0 only for the ring's geometry — the stat card above reports
              the absent state honestly as an em dash. */}
          <ScoreRing value={stats?.avg_ats_score ?? 0} size={104} strokeWidth={7} label="ATS" />
          <div className="flex items-center gap-2 text-xs text-[var(--color-ink-faint)]">
            <CalendarDays className="w-3.5 h-3.5" />
            {dateLabel}
          </div>
        </div>
      </motion.div>

      {/* Jobs left, policy right — the two time-sensitive feeds, above the
          slower-moving progress metrics. On narrow screens the grid collapses
          and jobs come first, which is the ordering that matters when only one
          fits on screen.

          Skeletons rather than nothing while loading: this block sits above
          the fold now, so an empty gap would push the whole page down and then
          snap it back when the request lands. */}
      {overview ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <FreshJobsPanel jobs={overview.fresh_jobs} window={overview.fresh_window} />
          <PolicyNewsPanel articles={overview.news} reachable={overview.news_reachable} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Skeleton className="h-[320px]" />
          <Skeleton className="h-[320px]" />
        </div>
      )}


      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {STAT_CARDS.map(({ icon: Icon, label, value, change, color }, i) => {
          const { number, suffix } = splitStat(value);
          return (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: i * 0.08, ease: EASE }}
              className="glass-card-hover p-5 group hover:-translate-y-0.5"
            >
              <div className="flex items-center justify-between mb-4">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center transition-transform duration-300 group-hover:scale-110"
                  style={{ backgroundColor: `${color}15`, boxShadow: `0 0 0 1px ${color}25` }}
                >
                  <Icon className="w-4 h-4" style={{ color }} />
                </div>
              </div>
              <div className="text-2xl font-display font-bold text-[var(--color-ink)] mb-1 tabular-nums">
                {number}
                {suffix}
              </div>
              <div className="text-xs text-[var(--color-ink-dim)] mb-2">{label}</div>
              <div className="flex items-center gap-1 text-xs font-medium" style={{ color }}>
                <TrendingUp className="w-3 h-3" />
                {change}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Quick actions + Recent sessions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Quick Actions */}
        <motion.div
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, delay: 0.2, ease: EASE }}
          className="glass-card p-5"
        >
          <h2 className="text-sm font-semibold text-[var(--color-ink)] mb-4">Quick Actions</h2>
          <div className="space-y-1.5">
            {QUICK_ACTIONS.map(({ icon: Icon, label, desc, href, color }) => (
              <Link
                key={label}
                href={href}
                className="flex items-center gap-3 p-3 rounded-xl hover:bg-canvas-elevated transition-colors group"
              >
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110"
                  style={{ backgroundColor: `${color}15`, boxShadow: `0 0 0 1px ${color}20` }}
                >
                  <Icon className="w-4 h-4" style={{ color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--color-ink)] group-hover:text-[var(--color-accent-light)] transition-colors">{label}</div>
                  <div className="text-xs text-[var(--color-ink-faint)]">{desc}</div>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-[var(--color-ink-faint)] group-hover:text-[var(--color-accent)] group-hover:translate-x-0.5 transition-all" />
              </Link>
            ))}
          </div>
        </motion.div>

        {/* Recent Sessions */}
        <motion.div
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, delay: 0.25, ease: EASE }}
          className="lg:col-span-2 glass-card p-5"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-[var(--color-ink)]">Recent Activity</h2>
            <Link href="/history" className="text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-light)] transition-colors flex items-center gap-1">
              View all
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {loading ? (
            /* Matched to the real row below — 36px icon, two text lines, same
               gap and padding — so hydration swaps content in without the
               list jumping. A centred one-line "Loading…" collapses to a
               taller list on arrival, which is the shift itself. */
            <div className="space-y-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-4 p-3">
                  <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-2/5" />
                    <Skeleton className="h-3 w-3/5" />
                  </div>
                </div>
              ))}
            </div>
          ) : activity.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-[var(--color-ink-dim)]">Nothing here yet.</p>
              {!loading && (
                <Link
                  href="/resume"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-light)]"
                >
                  Analyze a resume to get started
                  <ArrowRight className="w-3 h-3" />
                </Link>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {activity.map((item, i) => (
                <motion.div
                  key={`${item.kind}-${item.id}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + i * 0.06, ease: EASE }}
                  className="flex items-center gap-4 p-3 rounded-xl hover:bg-canvas-elevated transition-colors"
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ring-1 ring-inset ${
                    item.kind === 'resume' ? 'bg-[var(--color-accent)]/15 ring-[var(--color-accent)]/25' : 'bg-[var(--color-accent-light)]/15 ring-[var(--color-accent-light)]/25'
                  }`}>
                    {item.kind === 'resume'
                      ? <FileSearch className="w-4 h-4 text-[var(--color-accent)]" />
                      : <MessageSquareCode className="w-4 h-4 text-[var(--color-accent-light)]" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[var(--color-ink)] truncate">{item.title}</div>
                    <div className="text-xs text-[var(--color-ink-faint)] flex items-center gap-2 mt-0.5">
                      <Clock className="w-3 h-3" />
                      {item.created_at ? new Date(item.created_at).toLocaleDateString() : '—'}
                      {' · '}
                      {item.kind === 'resume' ? 'Resume scan' : 'Interview session'}
                    </div>
                    {/* Bar only where there's a score to draw. Interview
                        sessions carry none until their answers are graded. */}
                    {item.score !== null && (
                      <div className="h-1 rounded-full bg-[var(--color-canvas-line-soft)] mt-2 overflow-hidden max-w-[160px]">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-lighter)]"
                          style={{ width: `${Math.min(100, Math.max(0, item.score))}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold text-[var(--color-accent-lighter)]">
                      {item.score !== null ? `${item.score}%` : '—'}
                    </div>
                    <div className="text-xs text-[var(--color-ink-faint)]">
                      {item.score !== null ? 'ATS' : 'Session'}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>
      </div>

      {/* Performance chart */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.4, ease: EASE }}
        className="glass-card p-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-ink)]">Performance Over Time</h2>
            <p className="text-xs text-[var(--color-ink-faint)] mt-0.5">ATS score and interview performance trends</p>
          </div>
          <div className="flex items-center gap-4 text-xs text-[var(--color-ink-dim)]">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-[2.5px] rounded-full bg-[var(--color-accent)]" />
              ATS Score
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-[2.5px] rounded-full bg-[var(--color-accent-light)]" style={{ backgroundImage: `repeating-linear-gradient(90deg, ${palette.accentLight} 0 3px, transparent 3px 5px)` }} />
              Interview
            </div>
          </div>
        </div>

        <div className="h-64 md:h-72 -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={PERFORMANCE_DATA} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="atsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={palette.accent} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={palette.accent} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="#1e1e1e" strokeDasharray="3 5" />
              <XAxis
                dataKey="month"
                axisLine={false}
                tickLine={false}
                tick={{ fill: palette.inkFaint, fontSize: 11 }}
                dy={8}
              />
              <YAxis hide domain={[0, 100]} />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#262626', strokeWidth: 1 }} />
              <Area
                type="monotone"
                dataKey="ats"
                name="ATS Score"
                stroke={palette.accent}
                strokeWidth={2.5}
                fill="url(#atsFill)"
                activeDot={{ r: 4, fill: palette.accent, stroke: '#0A0A0A', strokeWidth: 2 }}
                animationDuration={900}
              />
              <Line
                type="monotone"
                dataKey="interview"
                name="Interview Score"
                stroke={palette.accentLight}
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                activeDot={{ r: 4, fill: palette.accentLight, stroke: '#0A0A0A', strokeWidth: 2 }}
                animationDuration={900}
                animationBegin={150}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      {/* Co-branding. Placed at the foot of the page rather than the header:
          it is an attribution, not a product claim. */}
      <div className="flex items-center justify-center gap-2 border-t border-[var(--color-canvas-line)] pt-5">
        <span className="h-1 w-1 rounded-full bg-[var(--color-ink-faint)]" />
        <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
          Developed in collaboration with Chieac Organisation
        </span>
        <span className="h-1 w-1 rounded-full bg-[var(--color-ink-faint)]" />
      </div>
    </div>
  );
}
