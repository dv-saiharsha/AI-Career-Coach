'use client';

import { useEffect, useMemo, useState } from 'react';
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
  Check,
} from 'lucide-react';
import Link from 'next/link';
import { useAccentPalette, useChartTheme } from '../../../lib/useAccentPalette';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/resume/InlineError';
import {
  downloadResumeReport,
  viewOriginalResume,
  deleteResumeAnalysis,
  getInterviewHistory,
  getResumeHistory,
  type InterviewHistoryItem,
  type ResumeHistoryItem,
} from '@/lib/apiClient';

type ReportRow =
  | { kind: 'resume'; id: number; title: string; date: string; score: number }
  | { kind: 'interview'; id: number; title: string; date: string; score: number | null };

const FILTERS = ['All', 'Resume', 'Interview'] as const;
type Filter = (typeof FILTERS)[number];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function ScoreRing({ score, size = 40 }: { score: number | null; size?: number }) {
  const palette = useAccentPalette();
  const chart = useChartTheme();
  const stroke = 3.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = score === null ? 0 : Math.min(100, Math.max(0, score));
  const offset = circumference - (pct / 100) * circumference;
  const color =
    score === null ? palette.inkFaint : score >= 85 ? palette.accentLighter : score >= 70 ? palette.accent : palette.accentDim;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={chart.grid} strokeWidth={stroke} />
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
      <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-(--color-ink) tabular-nums">
        {score === null ? '—' : Math.round(score)}
      </div>
    </div>
  );
}

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`bg-(--color-canvas-raise) border border-(--color-canvas-line-soft) rounded-2xl animate-pulse ${className}`} />;
}

export default function ReportsPage() {
  const [resumeHistory, setResumeHistory] = useState<ResumeHistoryItem[]>([]);
  const [interviewHistory, setInterviewHistory] = useState<InterviewHistoryItem[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [filter, setFilter] = useState<Filter>('All');

  // Two-step delete, tracked by id — the first click arms it, the second
  // commits, matching the exact pattern History already uses for the same
  // underlying action on the same resource.
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<number | null>(null);

  // Reused for both the initial fetch and the retry button. The mount
  // effect below doesn't set `status` to 'loading' itself — the useState
  // default already is — so only the retry path (an event handler, not an
  // effect) needs to reset it before re-fetching.
  function fetchReports() {
    return Promise.all([getResumeHistory(), getInterviewHistory()])
      .then(([resumes, interviews]) => {
        setResumeHistory(resumes);
        setInterviewHistory(interviews);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }

  function retry() {
    setStatus('loading');
    fetchReports();
  }

  useEffect(() => {
    fetchReports();
  }, []);

  const rows = useMemo<ReportRow[]>(() => {
    const resumeRows: ReportRow[] = resumeHistory.map((item) => ({
      kind: 'resume',
      id: item.id,
      title: item.resume_filename,
      date: item.created_at,
      score: Math.round(item.ats_score),
    }));
    const interviewRows: ReportRow[] = interviewHistory
      .filter((item) => item.status === 'completed')
      .map((item) => ({
        kind: 'interview',
        id: item.id,
        title: `${item.role} · ${item.seniority}`,
        date: item.created_at,
        score: item.average_score,
      }));
    return [...resumeRows, ...interviewRows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [resumeHistory, interviewHistory]);

  const filtered = useMemo(
    () => (filter === 'All' ? rows : rows.filter((r) => (filter === 'Resume' ? r.kind === 'resume' : r.kind === 'interview'))),
    [rows, filter],
  );

  const summary = useMemo(() => {
    const resumeCount = rows.filter((r) => r.kind === 'resume').length;
    const interviewCount = rows.filter((r) => r.kind === 'interview').length;
    const scored = rows.filter((r) => r.score !== null) as (ReportRow & { score: number })[];
    const avgScore = scored.length ? Math.round(scored.reduce((sum, r) => sum + r.score, 0) / scored.length) : null;
    return [
      { icon: FolderOpen, label: 'Total Reports', value: String(rows.length), sub: 'All time' },
      { icon: FileText, label: 'Resume Reports', value: String(resumeCount), sub: 'ATS analyses' },
      { icon: MessageSquareCode, label: 'Interview Reports', value: String(interviewCount), sub: 'Completed sessions' },
      { icon: Gauge, label: 'Average Score', value: avgScore === null ? '—' : `${avgScore}%`, sub: 'Across scored reports' },
    ];
  }, [rows]);

  const isEmpty = status === 'ready' && rows.length === 0;

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader
        eyebrow="Reports"
        eyebrowIcon={FileText}
        title="Every report you've generated."
        description="Every resume scan and completed interview session, with the same report you can view or download from where it was created."
        action={
          <Link href="/resume" className="btn-primary">
            <Plus className="w-4 h-4" />
            New Analysis
          </Link>
        }
      />

      {status === 'error' && (
        <InlineError message="Couldn't load your reports." onRetry={retry} />
      )}

      {status !== 'error' && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {status === 'loading'
              ? Array.from({ length: 4 }).map((_, i) => <SkeletonBlock key={i} className="h-[104px]" />)
              : summary.map(({ icon: Icon, label, value, sub }, i) => (
                  <motion.div
                    key={label}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.06 }}
                    className="bg-(--color-canvas-raise) border border-(--color-canvas-line-soft) rounded-2xl p-5 hover:border-(--color-canvas-line) transition-colors"
                  >
                    <div className="w-8 h-8 rounded-lg bg-(--color-accent)/10 flex items-center justify-center mb-3">
                      <Icon className="w-4 h-4 text-(--color-accent)" />
                    </div>
                    <div className="text-xl font-display font-bold text-(--color-accent) tabular-nums">{value}</div>
                    <div className="text-xs font-medium text-(--color-ink) mt-0.5">{label}</div>
                    <div className="text-xs text-(--color-ink-faint) mt-0.5">{sub}</div>
                  </motion.div>
                ))}
          </div>

          {!isEmpty && status !== 'loading' && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
              <Tabs.Root value={filter} onValueChange={(v) => setFilter(v as Filter)}>
                <Tabs.List className="flex items-center gap-1">
                  {FILTERS.map((f) => (
                    <Tabs.Trigger
                      key={f}
                      value={f}
                      className="px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all border border-transparent text-(--color-ink-faint) hover:text-(--color-ink-dim) hover:bg-canvas-elevated data-[state=active]:border-(--color-accent)/20 data-[state=active]:text-(--color-accent) data-[state=active]:bg-(--color-accent)/10"
                    >
                      {f}
                    </Tabs.Trigger>
                  ))}
                </Tabs.List>
              </Tabs.Root>
            </motion.div>
          )}

          {/* Ledger */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-(--color-canvas-raise) border border-(--color-canvas-line-soft) rounded-2xl overflow-hidden"
          >
            {status === 'loading' ? (
              <div className="divide-y divide-(--color-canvas)">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-[72px] animate-pulse bg-(--color-canvas-raise)" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 px-6 text-center">
                <div className="w-11 h-11 rounded-xl bg-(--color-accent)/10 flex items-center justify-center">
                  <FolderOpen className="w-5 h-5 text-(--color-accent)" />
                </div>
                <p className="text-sm text-(--color-ink-dim)">
                  {isEmpty
                    ? 'Scan a resume or complete a mock interview and it will show up here.'
                    : `No ${filter.toLowerCase()} reports yet.`}
                </p>
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {filtered.map((report, i) => (
                  <motion.div
                    key={`${report.kind}-${report.id}`}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ delay: Math.min(i, 8) * 0.05, duration: 0.35 }}
                    className="flex items-center gap-4 px-5 py-4 border-b border-(--color-canvas-line-soft) hover:bg-canvas-elevated transition-colors last:border-0"
                  >
                    <div className="w-9 h-9 rounded-lg bg-(--color-accent)/10 flex items-center justify-center shrink-0">
                      {report.kind === 'resume' ? (
                        <FileText className="w-4 h-4 text-(--color-accent)" />
                      ) : (
                        <MessageSquareCode className="w-4 h-4 text-(--color-accent-light)" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-(--color-ink) truncate">{report.title}</div>
                      <div className="flex items-center gap-2 text-xs text-(--color-ink-faint) mt-0.5">
                        <span
                          className={`px-1.5 py-0.5 rounded-full font-medium ${
                            report.kind === 'resume'
                              ? 'bg-(--color-accent)/10 text-(--color-accent)'
                              : 'bg-(--color-accent-light)/10 text-(--color-accent-light)'
                          }`}
                        >
                          {report.kind === 'resume' ? 'Resume' : 'Interview'}
                        </span>
                        <span className="hidden sm:inline">{formatDate(report.date)}</span>
                      </div>
                    </div>

                    <ScoreRing score={report.score} />

                    {report.kind === 'resume' ? (
                      <div className="flex shrink-0 items-center gap-0.5">
                        {actionError === report.id && (
                          <span className="mr-1 text-[10px] text-(--color-signal-low)">Didn&apos;t work</span>
                        )}
                        <DropdownMenu.Root>
                          <DropdownMenu.Trigger asChild>
                            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Actions for ${report.title}`}>
                              <MoreVertical />
                            </Button>
                          </DropdownMenu.Trigger>
                          <DropdownMenu.Portal>
                            <DropdownMenu.Content
                              align="end"
                              sideOffset={6}
                              className="bg-(--color-canvas-raise) border border-(--color-canvas-line) rounded-xl p-1.5 shadow-[0_16px_50px_rgba(0,0,0,0.6)] min-w-[160px] z-50"
                            >
                              <DropdownMenu.Item
                                onSelect={() => {
                                  setActionError(null);
                                  viewOriginalResume(report.id).catch(() => setActionError(report.id));
                                }}
                                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-(--color-ink-dim) hover:text-(--color-ink) hover:bg-canvas-elevated transition-colors outline-none cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                View original
                              </DropdownMenu.Item>
                              <DropdownMenu.Item
                                onSelect={() => downloadResumeReport(report.id, `resume-report-${report.id}.pdf`)}
                                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-(--color-ink-dim) hover:text-(--color-accent) hover:bg-(--color-accent)/10 transition-colors outline-none cursor-pointer"
                              >
                                <Download className="w-3.5 h-3.5" />
                                Download report
                              </DropdownMenu.Item>
                              <DropdownMenu.Separator className="h-px bg-(--color-canvas-line) my-1.5" />
                              <DropdownMenu.Item
                                onSelect={(e) => {
                                  e.preventDefault();
                                  setActionError(null);
                                  if (confirmingId !== report.id) {
                                    setConfirmingId(report.id);
                                    return;
                                  }
                                  setDeletingId(report.id);
                                  deleteResumeAnalysis(report.id)
                                    .then(() => setResumeHistory((rows) => rows.filter((r) => r.id !== report.id)))
                                    .catch(() => setActionError(report.id))
                                    .finally(() => {
                                      setDeletingId(null);
                                      setConfirmingId(null);
                                    });
                                }}
                                disabled={deletingId === report.id}
                                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-(--color-ink-dim) hover:text-(--color-error) hover:bg-(--color-error)/10 transition-colors outline-none cursor-pointer"
                              >
                                {confirmingId === report.id ? <Check className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                                {confirmingId === report.id ? 'Confirm delete' : 'Delete'}
                              </DropdownMenu.Item>
                            </DropdownMenu.Content>
                          </DropdownMenu.Portal>
                        </DropdownMenu.Root>
                      </div>
                    ) : (
                      // No standalone interview-report view/export exists yet —
                      // an empty spacer, not a fake menu, matching History's own
                      // honest choice for the same row kind.
                      <div className="w-8 shrink-0" />
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </motion.div>
        </>
      )}
    </div>
  );
}
