'use client';

import { motion } from 'framer-motion';
import {
  FileSearch, MessageSquareCode, TrendingUp, Trophy, ArrowRight, Clock, Target, BarChart2, CalendarDays,
} from 'lucide-react';
import Link from 'next/link';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useAuth } from '../../../lib/AuthContext';
import { useAccentPalette } from '../../../lib/useAccentPalette';

const EASE = [0.22, 1, 0.36, 1] as const;

const RECENT_SESSIONS = [
  { type: 'resume', title: 'Software_Engineer_Resume.pdf', score: 87, date: '2 hours ago', role: 'SWE @ Google' },
  { type: 'interview', title: 'Senior Backend Engineer', score: 82, date: '1 day ago', role: 'Interview Session' },
  { type: 'resume', title: 'ML_Engineer_Resume_v3.pdf', score: 91, date: '3 days ago', role: 'ML @ OpenAI' },
  { type: 'interview', title: 'System Design Round', score: 76, date: '5 days ago', role: 'Interview Session' },
];

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
  const { user } = useAuth();
  const palette = useAccentPalette();
  const STAT_CARDS = [
    { icon: FileSearch, label: 'Resumes Analyzed', value: '12', change: '+3 this week', color: palette.accent },
    { icon: MessageSquareCode, label: 'Interview Sessions', value: '28', change: '+5 this week', color: palette.accentLight },
    { icon: Target, label: 'Avg ATS Score', value: '84%', change: '+12% vs last month', color: palette.accentLighter },
    { icon: BarChart2, label: 'Interview Score', value: '78', change: '+8 pts this week', color: palette.accent },
  ];
  const QUICK_ACTIONS = [
    { icon: FileSearch, label: 'Analyze Resume', desc: 'Upload and get instant ATS score', href: '/resume', color: palette.accent },
    { icon: MessageSquareCode, label: 'Mock Interview', desc: 'Practice with AI coach', href: '/interview', color: palette.accentLight },
    { icon: TrendingUp, label: 'View Analytics', desc: 'Track your progress', href: '/analytics', color: palette.accentLighter },
    { icon: Trophy, label: 'Achievements', desc: 'See your milestones', href: '/achievements', color: palette.accent },
  ];
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="space-y-7 max-w-7xl">
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
            {greeting}, <span className="gradient-text-violet">{user?.email?.split('@')[0] ?? 'there'}</span>
          </h1>
          <p className="text-sm text-[var(--color-ink-dim)] mt-1.5">
            Here&apos;s your career progress overview.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--color-ink-faint)] shrink-0">
          <CalendarDays className="w-3.5 h-3.5" />
          {dateLabel}
        </div>
      </motion.div>

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
                className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors group"
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
          <div className="space-y-1">
            {RECENT_SESSIONS.map((session, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.06, ease: EASE }}
                className="flex items-center gap-4 p-3 rounded-xl hover:bg-white/5 transition-colors"
              >
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ring-1 ring-inset ${
                  session.type === 'resume' ? 'bg-[var(--color-accent)]/15 ring-[var(--color-accent)]/25' : 'bg-[var(--color-accent-light)]/15 ring-[var(--color-accent-light)]/25'
                }`}>
                  {session.type === 'resume'
                    ? <FileSearch className="w-4 h-4 text-[var(--color-accent)]" />
                    : <MessageSquareCode className="w-4 h-4 text-[var(--color-accent-light)]" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--color-ink)] truncate">{session.title}</div>
                  <div className="text-xs text-[var(--color-ink-faint)] flex items-center gap-2 mt-0.5">
                    <Clock className="w-3 h-3" />
                    {session.date} · {session.role}
                  </div>
                  <div className="h-1 rounded-full bg-[var(--color-canvas-line-soft)] mt-2 overflow-hidden max-w-[160px]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-lighter)]"
                      style={{ width: `${session.score}%` }}
                    />
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold text-[var(--color-accent-lighter)]">{session.score}%</div>
                  <div className="text-xs text-[var(--color-ink-faint)]">Score</div>
                </div>
              </motion.div>
            ))}
          </div>
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
    </div>
  );
}
