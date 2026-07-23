'use client';

import { useMemo, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import CountUp from 'react-countup';
import {
  Trophy,
  Star,
  Target,
  Zap,
  MessageSquareCode,
  FileSearch,
  TrendingUp,
  Award,
  Lock,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useAccentPalette } from '../../../lib/useAccentPalette';

type Tier = 'Common' | 'Rare' | 'Epic';

interface Achievement {
  icon: LucideIcon;
  title: string;
  desc: string;
  earned: boolean;
  date?: string;
  progress?: number;
  total?: number;
  tier: Tier;
}

const ACHIEVEMENTS: Achievement[] = [
  { icon: FileSearch, title: 'First Analysis', desc: 'Completed your first resume analysis', earned: true, date: 'Jul 15', tier: 'Common' },
  { icon: Star, title: 'ATS Champion', desc: 'Achieved an ATS score of 90%+', earned: true, date: 'Nov 3', tier: 'Common' },
  { icon: MessageSquareCode, title: 'Interview Warrior', desc: 'Completed 10 mock interview sessions', earned: true, date: 'Oct 22', tier: 'Rare' },
  { icon: TrendingUp, title: 'Consistent Improver', desc: 'Improved ATS score 5 sessions in a row', earned: true, date: 'Sep 10', tier: 'Epic' },
  { icon: Zap, title: 'Speed Demon', desc: 'Complete 5 analyses in one day', earned: false, progress: 3, total: 5, tier: 'Common' },
  { icon: Trophy, title: 'Interview Master', desc: 'Score 90+ on an interview session', earned: false, progress: 84, total: 90, tier: 'Rare' },
  { icon: Target, title: 'Perfect Score', desc: 'Achieve a 100% ATS match score', earned: false, progress: 91, total: 100, tier: 'Epic' },
  { icon: Award, title: '30-Day Streak', desc: 'Practice every day for 30 days', earned: false, progress: 7, total: 30, tier: 'Epic' },
];

function ProgressRing({ pct }: { pct: number }) {
  const palette = useAccentPalette();
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative w-24 h-24 sm:w-28 sm:h-28 shrink-0">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#1e1e1e" strokeWidth="8" />
        <motion.circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="url(#achievement-ring-gradient)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c - (pct / 100) * c }}
          transition={{ duration: 1.3, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
        />
        <defs>
          <linearGradient id="achievement-ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={palette.accent} />
            <stop offset="100%" stopColor={palette.accentLighter} />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl sm:text-2xl font-display font-bold text-[var(--color-ink)] tabular-nums">
          <CountUp end={pct} duration={1.4} decimals={0} />%
        </span>
        <span className="text-[9px] uppercase tracking-widest text-[var(--color-ink-faint)] font-mono">Complete</span>
      </div>
    </div>
  );
}

function StatTile({ icon: Icon, label, value, sub }: { icon: LucideIcon; label: string; value: ReactNode; sub: string }) {
  return (
    <div className="glass-card p-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-xl bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 flex items-center justify-center shrink-0">
        <Icon className="w-[18px] h-[18px] text-[var(--color-accent)]" />
      </div>
      <div className="min-w-0">
        <div className="text-xs font-mono uppercase tracking-widest text-[var(--color-ink-faint)]">{label}</div>
        <div className="text-base font-semibold text-[var(--color-ink)] truncate">{value}</div>
        <div className="text-xs text-[var(--color-ink-faint)] truncate">{sub}</div>
      </div>
    </div>
  );
}

export default function AchievementsPage() {
  const palette = useAccentPalette();
  const TIER_STYLES: Record<Tier, { color: string; glow: string }> = {
    Common: { color: palette.accent, glow: 'rgba(var(--color-accent-rgb),0.4)' },
    Rare: { color: palette.accentLight, glow: 'rgba(var(--color-accent-light-rgb),0.4)' },
    Epic: { color: palette.accentLighter, glow: 'rgba(var(--color-accent-lighter-rgb),0.45)' },
  };
  const earned = useMemo(() => ACHIEVEMENTS.filter((a) => a.earned), []);
  const pending = useMemo(() => ACHIEVEMENTS.filter((a) => !a.earned), []);
  const pct = Math.round((earned.length / ACHIEVEMENTS.length) * 100);

  const nearest = useMemo(() => {
    return [...pending]
      .filter((a) => a.progress !== undefined && a.total !== undefined)
      .sort((a, b) => (b.progress! / b.total!) - (a.progress! / a.total!))[0];
  }, [pending]);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
          <span className="section-eyebrow-violet mb-3 inline-flex">
            <Sparkles className="w-3 h-3" />
            Progress
          </span>
          <h1 className="text-2xl sm:text-3xl font-display font-semibold text-[var(--color-ink)] mb-1">Achievements</h1>
          <p className="text-sm text-[var(--color-ink-dim)]">
            {earned.length} of {ACHIEVEMENTS.length} achievements unlocked. Keep going to earn them all.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.15 }}
          className="self-center sm:self-auto"
        >
          <ProgressRing pct={pct} />
        </motion.div>
      </div>

      {/* Stat strip */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-1 sm:grid-cols-3 gap-3"
      >
        <StatTile icon={Trophy} label="Unlocked" value={<CountUp end={earned.length} duration={1.2} />} sub={`of ${ACHIEVEMENTS.length} total`} />
        <StatTile icon={Target} label="In Progress" value={<CountUp end={pending.length} duration={1.2} />} sub="badges within reach" />
        <StatTile
          icon={Zap}
          label="Next Unlock"
          value={nearest ? nearest.title : 'All caught up'}
          sub={nearest ? `${nearest.progress}/${nearest.total}` : 'Nothing pending'}
        />
      </motion.div>

      {/* Earned */}
      <div>
        <h2 className="text-xs font-semibold text-[var(--color-ink-dim)] uppercase tracking-widest font-mono mb-4">
          Unlocked <span className="text-[var(--color-ink-faint)]">— {earned.length}</span>
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {earned.map(({ icon: Icon, title, desc, date, tier }, i) => {
            const style = TIER_STYLES[tier];
            return (
              <motion.div
                key={title}
                initial={{ opacity: 0, scale: 0.7, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ delay: 0.35 + i * 0.08, type: 'spring', stiffness: 260, damping: 20 }}
                whileHover={{ y: -4 }}
                className="glass-card-hover relative flex flex-col items-center text-center gap-3 p-5"
              >
                <span
                  className="absolute top-3 right-3 text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full"
                  style={{ color: style.color, backgroundColor: `${style.color}15`, border: `1px solid ${style.color}30` }}
                >
                  {tier}
                </span>

                <div className="relative w-16 h-16">
                  <div
                    className="absolute inset-0 rounded-full heartbeat-glow"
                    style={{ boxShadow: `0 0 22px 6px ${style.glow}` }}
                  />
                  <div
                    className="relative w-16 h-16 rounded-full flex items-center justify-center"
                    style={{ background: `linear-gradient(135deg, ${style.color}35, ${style.color}10)`, border: `1.5px solid ${style.color}55` }}
                  >
                    <Icon className="w-7 h-7" style={{ color: style.color }} />
                  </div>
                </div>

                <div>
                  <div className="text-sm font-semibold text-[var(--color-ink)]">{title}</div>
                  <div className="text-xs text-[var(--color-ink-faint)] mt-1 leading-relaxed">{desc}</div>
                </div>
                <div className="text-[11px] font-mono text-[var(--color-accent)]">Earned {date}</div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Locked */}
      <div>
        <h2 className="text-xs font-semibold text-[var(--color-ink-dim)] uppercase tracking-widest font-mono mb-4">
          Locked <span className="text-[var(--color-ink-faint)]">— {pending.length}</span>
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {pending.map(({ icon: Icon, title, desc, progress, total, tier }, i) => {
            const style = TIER_STYLES[tier];
            const ratio = progress !== undefined && total !== undefined ? progress / total : 0;
            return (
              <motion.div
                key={title}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35 + earned.length * 0.08 + i * 0.06 }}
                className="glass-card relative flex flex-col items-center text-center gap-3 p-5 opacity-90"
              >
                <span
                  className="absolute top-3 right-3 text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full bg-[var(--color-canvas)] border border-[var(--color-canvas-line)] text-[var(--color-ink-faint)]"
                >
                  {tier}
                </span>

                <div className="relative w-16 h-16">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line)]">
                    <Icon className="w-7 h-7 text-[var(--color-ink-faint)]" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line)] flex items-center justify-center">
                    <Lock className="w-3 h-3 text-[var(--color-ink-faint)]" />
                  </div>
                </div>

                <div>
                  <div className="text-sm font-semibold text-[var(--color-ink-dim)]">{title}</div>
                  <div className="text-xs text-[var(--color-ink-faint)] mt-1 leading-relaxed">{desc}</div>
                </div>

                {progress !== undefined && total !== undefined && (
                  <div className="w-full mt-1">
                    <div className="flex justify-between text-[10px] font-mono text-[var(--color-ink-faint)] mb-1.5">
                      <span>{progress}/{total}</span>
                      <span>{Math.round(ratio * 100)}%</span>
                    </div>
                    <div className="h-1.5 bg-[var(--color-canvas-line-soft)] rounded-full overflow-hidden">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: `linear-gradient(90deg, ${style.color}80, ${style.color})` }}
                        initial={{ width: 0 }}
                        animate={{ width: `${ratio * 100}%` }}
                        transition={{ duration: 1, ease: 'easeOut', delay: 0.5 }}
                      />
                    </div>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
