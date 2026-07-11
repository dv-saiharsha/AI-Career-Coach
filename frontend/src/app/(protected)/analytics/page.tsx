'use client';

import { motion } from 'framer-motion';
import CountUp from 'react-countup';
import { TrendingUp, Target, MessageSquareCode, Calendar } from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LabelList,
} from 'recharts';
import { useAccentPalette } from '../../../lib/useAccentPalette';

const SCORE_HISTORY = [
  { month: 'Jul', ats: 72, interview: 68 },
  { month: 'Aug', ats: 78, interview: 72 },
  { month: 'Sep', ats: 81, interview: 75 },
  { month: 'Oct', ats: 85, interview: 80 },
  { month: 'Nov', ats: 83, interview: 82 },
  { month: 'Dec', ats: 87, interview: 84 },
];

const MONTHLY_SESSIONS = [
  { month: 'Jul', sessions: 3 },
  { month: 'Aug', sessions: 4 },
  { month: 'Sep', sessions: 5 },
  { month: 'Oct', sessions: 6 },
  { month: 'Nov', sessions: 4 },
  { month: 'Dec', sessions: 6 },
];

const SKILL_BREAKDOWN = [
  { skill: 'Python', score: 92, sessions: 8 },
  { skill: 'System Design', score: 78, sessions: 5 },
  { skill: 'SQL', score: 88, sessions: 4 },
  { skill: 'React', score: 84, sessions: 6 },
  { skill: 'Machine Learning', score: 71, sessions: 3 },
];

const STAT_CARDS = [
  { icon: Target, label: 'Best ATS Score', value: 91, prefix: '', suffix: '%', sub: 'ML_Engineer_v3.pdf' },
  { icon: MessageSquareCode, label: 'Total Sessions', value: 28, prefix: '', suffix: '', sub: 'Interview sessions' },
  { icon: TrendingUp, label: 'Improvement', value: 19, prefix: '+', suffix: '%', sub: 'ATS score, last 90 days' },
  { icon: Calendar, label: 'Practice Streak', value: 7, prefix: '', suffix: ' days', sub: 'Current streak' },
];

interface TrendTooltipProps {
  active?: boolean;
  payload?: { dataKey?: string; value?: number; color?: string }[];
  label?: string;
}

function TrendTooltip({ active, payload, label }: TrendTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line)] rounded-xl px-3.5 py-2.5 shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
      <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--color-ink-faint)] mb-1.5">{label}</div>
      <div className="flex flex-col gap-1">
        {payload.map((p) => (
          <div key={p.dataKey} className="flex items-center gap-2 text-xs">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: p.color }} />
            <span className="text-[var(--color-ink-dim)]">{p.dataKey === 'ats' ? 'ATS Score' : 'Interview Score'}</span>
            <span className="font-semibold text-[var(--color-ink)] ml-auto tabular-nums">{p.value}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface SessionsTooltipProps {
  active?: boolean;
  payload?: { value?: number }[];
  label?: string;
}

function SessionsTooltip({ active, payload, label }: SessionsTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line)] rounded-xl px-3.5 py-2.5 shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
      <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--color-ink-faint)] mb-1">{label}</div>
      <div className="text-xs text-[var(--color-ink)] font-semibold tabular-nums">{payload[0].value} sessions</div>
    </div>
  );
}

interface SkillTooltipProps {
  active?: boolean;
  payload?: { payload: { skill: string; score: number; sessions: number } }[];
}

function SkillTooltip({ active, payload }: SkillTooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line)] rounded-xl px-3.5 py-2.5 shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
      <div className="text-xs font-semibold text-[var(--color-ink)] mb-1">{d.skill}</div>
      <div className="text-xs text-[var(--color-ink-dim)]">
        <span className="text-[var(--color-accent)] font-semibold tabular-nums">{d.score}%</span> avg score &middot; {d.sessions} sessions
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const palette = useAccentPalette();
  const violet = palette.accent;
  const violetLight = palette.accentLight;

  return (
    <div className="space-y-6 max-w-6xl">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-display font-semibold text-[var(--color-ink)] mb-1">Analytics</h1>
        <p className="text-sm text-[var(--color-ink-dim)]">Track your performance trends and skill development.</p>
      </motion.div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {STAT_CARDS.map(({ icon: Icon, label, value, prefix, suffix, sub }, i) => (
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
              <CountUp end={value} duration={1.6} prefix={prefix} suffix={suffix} />
            </div>
            <div className="text-xs font-medium text-[var(--color-ink)] mt-0.5">{label}</div>
            <div className="text-xs text-[var(--color-ink-faint)] mt-0.5">{sub}</div>
          </motion.div>
        ))}
      </div>

      {/* Score trend chart */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line-soft)] rounded-2xl p-6"
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-ink)]">Score Trends</h2>
            <p className="text-xs text-[var(--color-ink-faint)] mt-0.5">Last 6 months</p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5 text-[var(--color-ink-dim)]"><span className="w-2 h-2 rounded-full bg-[var(--color-accent)]" />ATS Score</div>
            <div className="flex items-center gap-1.5 text-[var(--color-ink-dim)]"><span className="w-3 h-0 border-t-2 border-dashed border-[var(--color-accent-light)]" />Interview Score</div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={SCORE_HISTORY} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="atsFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={violet} stopOpacity={0.3} />
                <stop offset="100%" stopColor={violet} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="#1e1e1e" strokeDasharray="3 3" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: palette.inkFaint }} axisLine={false} tickLine={false} />
            <YAxis hide domain={[0, 100]} />
            <Tooltip content={<TrendTooltip />} cursor={{ stroke: palette.inkFaint, strokeWidth: 1 }} />
            <Area
              type="monotone"
              dataKey="ats"
              stroke={violet}
              strokeWidth={2.5}
              fill="url(#atsFill)"
              dot={{ r: 3, fill: violet, strokeWidth: 0 }}
              activeDot={{ r: 5, strokeWidth: 0 }}
              isAnimationActive
              animationDuration={900}
            />
            <Line
              type="monotone"
              dataKey="interview"
              stroke={violetLight}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={{ r: 3, fill: violetLight, strokeWidth: 0 }}
              activeDot={{ r: 5, strokeWidth: 0 }}
              isAnimationActive
              animationDuration={900}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </motion.div>

      {/* Skill breakdown + monthly sessions */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="lg:col-span-3 bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line-soft)] rounded-2xl p-6"
        >
          <h2 className="text-sm font-semibold text-[var(--color-ink)] mb-1">Performance by Skill</h2>
          <p className="text-xs text-[var(--color-ink-faint)] mb-4">Average score across practiced topics</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={SKILL_BREAKDOWN} layout="vertical" margin={{ top: 0, right: 34, left: 0, bottom: 0 }}>
              <CartesianGrid horizontal={false} stroke="#1e1e1e" strokeDasharray="3 3" />
              <XAxis type="number" domain={[0, 100]} hide />
              <YAxis
                type="category"
                dataKey="skill"
                width={112}
                tick={{ fontSize: 12, fill: '#FAFAFA' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<SkillTooltip />} cursor={{ fill: 'rgba(var(--color-accent-rgb),0.06)' }} />
              <Bar dataKey="score" radius={[0, 8, 8, 0]} fill={violet} maxBarSize={14} isAnimationActive animationDuration={800}>
                <LabelList
                  dataKey="score"
                  position="right"
                  formatter={(v: React.ReactNode) => `${v}%`}
                  style={{ fill: palette.inkDim, fontSize: 11, fontWeight: 600 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="lg:col-span-2 bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line-soft)] rounded-2xl p-6"
        >
          <h2 className="text-sm font-semibold text-[var(--color-ink)] mb-1">Practice Consistency</h2>
          <p className="text-xs text-[var(--color-ink-faint)] mb-4">Interview sessions per month</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={MONTHLY_SESSIONS} margin={{ top: 4, right: 4, left: -30, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#1e1e1e" strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: palette.inkFaint }} axisLine={false} tickLine={false} />
              <YAxis hide domain={[0, 'dataMax + 2']} />
              <Tooltip content={<SessionsTooltip />} cursor={{ fill: 'rgba(var(--color-accent-rgb),0.06)' }} />
              <Bar dataKey="sessions" radius={[6, 6, 0, 0]} fill={violetLight} maxBarSize={26} isAnimationActive animationDuration={800} />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      </div>
    </div>
  );
}
