'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as Tabs from '@radix-ui/react-tabs';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  FileText,
  MessageSquareCode,
  Download,
  Eye,
  Trash2,
  Plus,
  MoreVertical,
  FolderOpen,
  Gauge,
} from 'lucide-react';
import Link from 'next/link';
import { useAccentPalette } from '../../../lib/useAccentPalette';

type ReportType = 'Resume' | 'Interview';

interface Report {
  name: string;
  type: ReportType;
  date: string;
  score: number;
  size: string;
}

const REPORTS: Report[] = [
  { name: 'ATS_Analysis_Google_SWE.pdf', type: 'Resume', date: 'Dec 10, 2024', score: 87, size: '2.4 MB' },
  { name: 'Interview_Session_Backend_Eng.pdf', type: 'Interview', date: 'Nov 28, 2024', score: 82, size: '1.8 MB' },
  { name: 'ATS_Analysis_OpenAI_ML.pdf', type: 'Resume', date: 'Nov 15, 2024', score: 91, size: '2.1 MB' },
  { name: 'Interview_System_Design_Round.pdf', type: 'Interview', date: 'Nov 5, 2024', score: 76, size: '1.5 MB' },
  { name: 'ATS_Analysis_Meta_PM.pdf', type: 'Resume', date: 'Oct 22, 2024', score: 79, size: '2.0 MB' },
];

const FILTERS = ['All', 'Resume', 'Interview'] as const;

function ScoreRing({ score, size = 40 }: { score: number; size?: number }) {
  const palette = useAccentPalette();
  const stroke = 3.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, score)) / 100) * circumference;
  const color = score >= 85 ? palette.accentLighter : score >= 70 ? palette.accent : palette.accentDim;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1e1e1e" strokeWidth={stroke} />
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
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-[var(--color-ink)] tabular-nums">
        {score}
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');

  const filtered = useMemo(
    () => (filter === 'All' ? REPORTS : REPORTS.filter((r) => r.type === filter)),
    [filter],
  );

  const summary = useMemo(() => {
    const resumeCount = REPORTS.filter((r) => r.type === 'Resume').length;
    const interviewCount = REPORTS.filter((r) => r.type === 'Interview').length;
    const avgScore = Math.round(REPORTS.reduce((sum, r) => sum + r.score, 0) / REPORTS.length);
    return [
      { icon: FolderOpen, label: 'Total Reports', value: REPORTS.length, sub: 'All time' },
      { icon: FileText, label: 'Resume Reports', value: resumeCount, sub: 'ATS analyses' },
      { icon: MessageSquareCode, label: 'Interview Reports', value: interviewCount, sub: 'Mock sessions' },
      { icon: Gauge, label: 'Average Score', value: `${avgScore}%`, sub: 'Across all reports' },
    ];
  }, []);

  return (
    <div className="space-y-6 max-w-5xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between flex-wrap gap-4"
      >
        <div>
          <h1 className="text-2xl font-display font-semibold text-[var(--color-ink)] mb-1">Reports</h1>
          <p className="text-sm text-[var(--color-ink-dim)]">All your generated analysis and interview reports.</p>
        </div>
        <Link
          href="/resume"
          className="btn-primary"
        >
          <Plus className="w-4 h-4" />
          New Analysis
        </Link>
      </motion.div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {summary.map(({ icon: Icon, label, value, sub }, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line-soft)] rounded-2xl p-5 hover:border-[var(--color-canvas-line)] transition-colors"
          >
            <div className="w-8 h-8 rounded-lg bg-[var(--color-accent)]/10 flex items-center justify-center mb-3">
              <Icon className="w-4 h-4 text-[var(--color-accent)]" />
            </div>
            <div className="text-xl font-display font-bold text-[var(--color-accent)] tabular-nums">{value}</div>
            <div className="text-xs font-medium text-[var(--color-ink)] mt-0.5">{label}</div>
            <div className="text-xs text-[var(--color-ink-faint)] mt-0.5">{sub}</div>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
        <Tabs.Root value={filter} onValueChange={(v) => setFilter(v as (typeof FILTERS)[number])}>
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

      {/* Ledger */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line-soft)] rounded-2xl overflow-hidden"
      >
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 px-6 text-center">
            <div className="w-11 h-11 rounded-xl bg-[var(--color-accent)]/10 flex items-center justify-center">
              <FolderOpen className="w-5 h-5 text-[var(--color-accent)]" />
            </div>
            <p className="text-sm text-[var(--color-ink-dim)]">No {filter.toLowerCase()} reports yet.</p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {filtered.map((report, i) => (
              <motion.div
                key={report.name}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ delay: 0.06 * i, duration: 0.35 }}
                className="flex items-center gap-4 px-5 py-4 border-b border-[var(--color-canvas)] hover:bg-white/[0.03] transition-colors last:border-0"
              >
                <div className="w-9 h-9 rounded-lg bg-[var(--color-accent)]/10 flex items-center justify-center shrink-0">
                  {report.type === 'Resume' ? (
                    <FileText className="w-4 h-4 text-[var(--color-accent)]" />
                  ) : (
                    <MessageSquareCode className="w-4 h-4 text-[var(--color-accent-light)]" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="text-sm text-[var(--color-ink)] truncate">{report.name}</div>
                  <div className="flex items-center gap-2 text-xs text-[var(--color-ink-faint)] mt-0.5">
                    <span
                      className={`px-1.5 py-0.5 rounded-full font-medium ${
                        report.type === 'Resume' ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'bg-[var(--color-accent-light)]/10 text-[var(--color-accent-light)]'
                      }`}
                    >
                      {report.type}
                    </span>
                    <span>{report.size}</span>
                    <span className="hidden sm:inline">&middot; {report.date}</span>
                  </div>
                </div>

                <ScoreRing score={report.score} />

                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      type="button"
                      className="p-2 rounded-lg text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] hover:bg-white/5 transition-colors shrink-0 outline-none"
                      aria-label={`Actions for ${report.name}`}
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      align="end"
                      sideOffset={6}
                      className="bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line)] rounded-xl p-1.5 shadow-[0_16px_50px_rgba(0,0,0,0.6)] min-w-[160px] z-50"
                    >
                      <DropdownMenu.Item className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] hover:bg-white/5 transition-colors outline-none cursor-pointer">
                        <Eye className="w-3.5 h-3.5" />
                        View report
                      </DropdownMenu.Item>
                      <DropdownMenu.Item className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-[var(--color-ink-dim)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors outline-none cursor-pointer">
                        <Download className="w-3.5 h-3.5" />
                        Download
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator className="h-px bg-[var(--color-canvas-line)] my-1.5" />
                      <DropdownMenu.Item className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-[var(--color-ink-dim)] hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/10 transition-colors outline-none cursor-pointer">
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </motion.div>
    </div>
  );
}
