'use client';

import { useQuery } from '@tanstack/react-query';
import {
  FileSearch, MessageSquareCode, TrendingUp, ArrowRight, Clock, Target, CalendarDays,
  Briefcase, KanbanSquare, Mic, GraduationCap, Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '../../../lib/AuthContext';
import { useAccentPalette } from '../../../lib/useAccentPalette';
import { getDashboardHome, type DashboardHome } from '@/lib/apiClient';
import { STAGE_LABELS, STAGE_MARKERS } from '@/lib/applicationStages';
import { categoryLabel } from '@/lib/interviewCategories';
import { bandColor, bandForScore, bandLabel } from '@/lib/scoreBands';
import { ScoreRing } from '@/components/ScoreRing';
import { NextActionCard } from '@/components/NextActionCard';
import { OnboardingModal } from '@/components/onboarding/OnboardingModal';
import { ResumeReminderDrawer } from '@/components/onboarding/ResumeReminderDrawer';
import { Skeleton } from '@/components/ui/skeleton';
import { InlineError } from '@/components/resume/InlineError';
import ResumeTrendChart from '@/components/dashboard/ResumeTrendChart';
import { useDashboardData } from '../../../lib/useDashboardData';
import { Reveal, RevealGroup } from '@/lib/reveal'


const NEXT_ACTION_ICON: Record<string, typeof Sparkles> = {
  improve_resume: FileSearch,
  practice_interview: MessageSquareCode,
  apply_to_jobs: Briefcase,
  follow_up_recruiter: KanbanSquare,
  review_missing_skills: Target,
};

function StatCard({
  icon: Icon, label, value, change, color,
}: {
  icon: typeof Sparkles; label: string; value: string; change: string; color: string;
}) {
  return (
    <Reveal
     
     
     
      className="reveal-scale glass-card-hover p-5 group hover:-translate-y-0.5"
    >
      <div className="flex items-center justify-between mb-4">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center transition-transform duration-300 group-hover:scale-110"
          style={{ backgroundColor: `${color}15`, boxShadow: `0 0 0 1px ${color}25` }}
        >
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
      </div>
      {/* The figure carries the system's one hue; the label around it stays
          ink. This is the whole reason a hue was kept after going monochrome —
          a number in the same colour as its caption has to be found rather
          than seen. */}
      <div className="text-2xl font-display font-bold mb-1 tabular-nums" style={{ color }}>
        {value}
      </div>
      <div className="text-xs text-(--color-ink-dim) mb-2">{label}</div>
      <div className="flex items-center gap-1 text-xs font-medium" style={{ color }}>
        <TrendingUp className="w-3 h-3" />
        {change}
      </div>
    </Reveal>
  );
}

/** Em dash rather than 0 for absent values — a new account has no average
 *  score, and "0%" reads as a catastrophic result instead of an empty one. */
function show(value: number | null | undefined, suffix = ''): string {
  return value === null || value === undefined ? '—' : `${value}${suffix}`;
}

function DashboardContent({ home }: { home: DashboardHome }) {
  const palette = useAccentPalette();

  /* A figure is coloured by what it means, not by being a figure.
     bandColor is the single scale: green at STRONG and above, blue at GOOD,
     amber at NEEDS WORK, red at WEAK — the same one ScoreRing and the rubric
     use, so a 62 is the same colour everywhere it appears.

     A plain count is deliberately NOT coloured. Fourteen tracked applications
     is neither good nor bad, and painting it green would assert a verdict the
     number does not carry. Ink is the honest answer for a tally. */
  const statCards = [
    {
      icon: FileSearch,
      label: 'Resume Health',
      value: show(home.resume.latest_ats_score, '%'),
      change: home.resume.latest_filename ? bandLabel(home.resume.latest_band) : 'No scans yet',
      // The API's own band, not one re-derived here — the same score must
      // never read two ways in the same product.
      color: bandColor(home.resume.latest_band ?? bandForScore(home.resume.latest_ats_score)),
    },
    {
      icon: KanbanSquare,
      label: 'Active Applications',
      value: show(home.applications.active),
      change: `${home.applications.total} tracked total`,
      color: palette.inkDim,
    },
    {
      icon: MessageSquareCode,
      label: 'Interview Readiness',
      value: home.interview.average_score != null ? `${home.interview.average_score}/10` : '—',
      change: home.interview.completed_sessions
        ? `${home.interview.completed_sessions} session(s) completed`
        : 'No sessions yet',
      // Scored out of 10; the band scale is defined over 100.
      color: bandColor(
        bandForScore(
          home.interview.average_score != null ? home.interview.average_score * 10 : null,
        ),
      ),
    },
    {
      icon: Target,
      label: 'Offer Success Rate',
      value: show(home.applications.success_rate, '%'),
      change: `${home.applications.offers} offer(s), ${home.applications.rejections} rejection(s)`,
      color: bandColor(bandForScore(home.applications.success_rate ?? null)),
    },
  ];

  const chartData = home.analytics.ats_history.map((point) => ({
    label: point.label,
    date: point.date ? new Date(point.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—',
    score: point.score,
  }));

  /* Matched listings when a resume exists, the freshest ones when it does
     not. Never nothing: openings are what this product always has to show,
     and an empty first screen is the worst thing a new account can meet. */
  /* Both optional-chained. A client is not always deployed in lockstep with
     the API it talks to — `latest` is newer than some running backends, and
     reading .length off an absent field takes the whole dashboard down with a
     TypeError rather than degrading to one missing panel. */
  const matched = home.jobs?.top_matches ?? []
  const leadJobs = matched.length > 0 ? matched : (home.jobs?.latest ?? [])
  const leadJobsAreMatched = matched.length > 0

  return (
    <>
      {/* Openings first.
          The page used to open on four stat tiles, which are a summary of
          activity that a new account does not have yet — so the first screen
          after signing up was four dashes and a prompt for a file. Jobs are
          the thing that is useful before you have given anything. */}
      {leadJobs.length > 0 && (
        <Reveal className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-(--color-ink)">
                {leadJobsAreMatched ? 'Matched to your resume' : 'Latest openings'}
              </h2>
              <p className="mt-0.5 text-xs text-(--color-ink-faint)">
                {leadJobsAreMatched
                  ? 'Scored against the resume you have on file.'
                  : 'Scan a resume to see these scored against it.'}
              </p>
            </div>
            <Link
              href="/jobs"
              className="flex items-center gap-1 text-xs text-(--color-accent) hover:text-(--color-accent-light)"
            >
              Browse all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {leadJobs.slice(0, 6).map((job) => (
              <a
                key={job.id}
                href={job.applyUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-start justify-between gap-3 rounded-lg p-3 transition-colors hover:bg-canvas-elevated field-ring-soft"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-(--color-ink)">{job.title}</p>
                  <p className="truncate text-xs text-(--color-ink-faint)">
                    {[job.company, job.location].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {/* A score only where one was computed. An unmatched listing
                    shows nothing rather than a placeholder percentage. */}
                {job.match?.overallMatch != null && job.match.band && (
                  <span
                    className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold tabular-nums"
                    style={{
                      color: bandColor(job.match.band),
                      background: `${bandColor(job.match.band)}15`,
                    }}
                  >
                    {Math.round(job.match.overallMatch)}%
                  </span>
                )}
              </a>
            ))}
          </div>
        </Reveal>
      )}

      {/* Next Actions — answers "what should I do next", right under the fold */}
      {home.next_actions.length > 0 && (
        <Reveal>
          <h2 className="text-sm font-semibold text-(--color-ink) mb-3">What to do next</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {home.next_actions.map((action) => (
              <NextActionCard key={action.key} action={action} icon={NEXT_ACTION_ICON[action.key]} />
            ))}
          </div>
        </Reveal>
      )}

      {/* Stats grid */}
      <RevealGroup className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <StatCard key={card.label} {...card} />
        ))}
      </RevealGroup>

      {/* Interview + Jobs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Reveal className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-(--color-ink)">Interview Progress</h2>
            <Link href="/interview" className="text-xs text-(--color-accent) hover:text-(--color-accent-light) flex items-center gap-1">
              Practice <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="rounded-xl bg-canvas-elevated p-3">
              <div className="flex items-center gap-1.5 text-(--color-ink-faint) text-[10px] uppercase tracking-widest mb-1">
                <GraduationCap className="w-3 h-3" /> Prep completed
              </div>
              <div className="text-lg font-display font-semibold text-(--color-ink) tabular-nums">
                {home.interview.prep_completed_count}
              </div>
            </div>
            <div className="rounded-xl bg-canvas-elevated p-3">
              <div className="flex items-center gap-1.5 text-(--color-ink-faint) text-[10px] uppercase tracking-widest mb-1">
                <Mic className="w-3 h-3" /> Voice answers
              </div>
              <div className="text-lg font-display font-semibold text-(--color-ink) tabular-nums">
                {home.interview.voice_answers_count}
              </div>
            </div>
          </div>
          {home.interview.latest_report ? (
            <Link
              href="/interview"
              className="flex items-center justify-between rounded-xl p-3 hover:bg-canvas-elevated transition-colors"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-(--color-ink) truncate">
                  {home.interview.latest_report.role} · {categoryLabel(home.interview.latest_report.category)}
                </p>
                <p className="text-xs text-(--color-ink-faint) mt-0.5">Most recent report</p>
              </div>
              {home.interview.latest_report.readiness_band && (
                <span
                  className="shrink-0 text-xs font-semibold px-2 py-1 rounded-lg"
                  style={{ color: bandColor(home.interview.latest_report.readiness_band), background: `${bandColor(home.interview.latest_report.readiness_band)}15` }}
                >
                  {bandLabel(home.interview.latest_report.readiness_band)}
                </span>
              )}
            </Link>
          ) : (
            <p className="text-sm text-(--color-ink-faint) text-center py-4">No completed mock interview yet.</p>
          )}
        </Reveal>

        {/* What to close, not what to apply to.
            The job list this panel used to carry is now the first block on
            the page, and showing the same three listings twice on one screen
            made the second one read as different results. What is left is the
            part the lead panel does not say: the skills worth closing and how
            a recruiter reads the match. */}
        <Reveal className="glass-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-(--color-ink)">Where you fall short</h2>
            <Link
              href="/resume"
              className="flex items-center gap-1 text-xs text-(--color-accent) hover:text-(--color-accent-light)"
            >
              Improve <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {(home.jobs?.missing_skills ?? []).length === 0 &&
          !home.jobs?.recruiter_perspective ? (
            <p className="py-4 text-center text-sm text-(--color-ink-faint)">
              Scan a resume against a job to see which skills are missing.
            </p>
          ) : (
            <div className="space-y-3">
              {(home.jobs?.missing_skills ?? []).length > 0 && (
                <div>
                  <p className="mb-1.5 text-[10px] uppercase tracking-widest text-(--color-ink-faint)">
                    Most worth closing
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {(home.jobs?.missing_skills ?? []).map((skill) => (
                      <span key={skill} className="chip text-[11px]">
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {home.jobs?.recruiter_perspective && (
                <p className="text-xs italic leading-relaxed text-(--color-ink-dim)">
                  “{home.jobs?.recruiter_perspective}”
                </p>
              )}
            </div>
          )}
        </Reveal>
      </div>

      {/* Activity + Upcoming Interviews */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Reveal className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-(--color-ink)">Recent Activity</h2>
            <Link href="/history" className="text-xs text-(--color-accent) hover:text-(--color-accent-light) flex items-center gap-1">
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {home.activity.recent_activity.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-(--color-ink-dim)">Nothing here yet.</p>
              <Link href="/resume" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-(--color-accent) hover:text-(--color-accent-light)">
                Analyze a resume to get started <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          ) : (
            <div className="space-y-1">
              {home.activity.recent_activity.map((item) => (
                <div key={`${item.kind}-${item.id}`} className="flex items-center gap-4 p-3 rounded-xl hover:bg-canvas-elevated transition-colors">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ring-1 ring-inset ${
                    item.kind === 'resume' ? 'bg-(--color-accent)/15 ring-(--color-accent)/25' : 'bg-(--color-accent-light)/15 ring-(--color-accent-light)/25'
                  }`}>
                    {item.kind === 'resume'
                      ? <FileSearch className="w-4 h-4 text-(--color-accent)" />
                      : <MessageSquareCode className="w-4 h-4 text-(--color-accent-light)" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-(--color-ink) truncate">{item.title}</div>
                    <div className="text-xs text-(--color-ink-faint) flex items-center gap-2 mt-0.5">
                      <Clock className="w-3 h-3" />
                      {item.created_at ? new Date(item.created_at).toLocaleDateString() : '—'}
                      {' · '}
                      {item.kind === 'resume' ? 'Resume scan' : 'Interview session'}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold text-(--color-accent-lighter)">
                      {item.score !== null ? `${item.score}%` : '—'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Reveal>

        <Reveal className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-(--color-ink)">Upcoming Interviews</h2>
            <Link href="/applications" className="text-xs text-(--color-accent) hover:text-(--color-accent-light) flex items-center gap-1">
              Open pipeline <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {home.activity.upcoming_interviews.length === 0 ? (
            <p className="text-sm text-(--color-ink-faint) text-center py-8">
              No applications currently at an interview stage.
            </p>
          ) : (
            <div className="space-y-1">
              {home.activity.upcoming_interviews.map((app) => (
                <div key={app.id} className="flex items-center gap-4 p-3 rounded-xl hover:bg-canvas-elevated transition-colors">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: STAGE_MARKERS[app.status] }} aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-(--color-ink) truncate">{app.job_title}</div>
                    <div className="text-xs text-(--color-ink-faint)">{app.company}</div>
                  </div>
                  <span className="text-xs text-(--color-ink-dim) shrink-0">{STAGE_LABELS[app.status]}</span>
                </div>
              ))}
            </div>
          )}
        </Reveal>
      </div>

      {/* Performance chart — real data (analytics.ats_history), not a fixture */}
      <Reveal className="glass-card p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div>
            <h2 className="text-sm font-semibold text-(--color-ink)">Resume Improvement Trend</h2>
            <p className="text-xs text-(--color-ink-faint) mt-0.5">ATS score across every scan you&apos;ve run</p>
          </div>
        </div>

        {chartData.length < 2 ? (
          <p className="text-sm text-(--color-ink-faint) text-center py-10">
            Scan at least two resumes to see a trend here.
          </p>
        ) : (
          <ResumeTrendChart data={chartData} />
        )}
      </Reveal>
    </>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const {
    profile,
    showOnboarding,
    submitError,
    finishOnboarding,
    skipOnboarding,
    showResumeReminder,
    dismissResumeReminder,
    uploadReminderResume,
  } = useDashboardData();

  const { data: home, isLoading, isError } = useQuery({
    queryKey: ['dashboard', 'home'],
    queryFn: getDashboardHome,
  });

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="space-y-7 max-w-7xl">
      {/* Onboarding interceptor. Rendered inside the dashboard rather than in
          the layout so it only blocks this page — a user mid-flow elsewhere
          isn't yanked into a modal. */}
      <OnboardingModal isOpen={showOnboarding} onComplete={finishOnboarding} onSkip={skipOnboarding} error={submitError} />

      {/* Follow-up for users who skipped the resume at onboarding. Non-blocking
          by design — the dashboard stays usable behind it. */}
      <ResumeReminderDrawer
        isOpen={showResumeReminder}
        onDismiss={dismissResumeReminder}
        onUpload={uploadReminderResume}
        error={submitError}
      />

      {/* Header */}
      <Reveal
       
       
       
        className="flex flex-col md:flex-row md:items-end md:justify-between gap-4"
      >
        <div>
          <span className="eyebrow mb-3 inline-flex">
            <span className="w-1.5 h-1.5 rounded-full bg-(--color-accent) heartbeat-glow" />
            Dashboard
          </span>
          <h1 className="text-2xl md:text-3xl font-display font-semibold text-(--color-ink) leading-tight">
            {greeting}, <span className="gradient-text-accent">{user?.firstName || 'there'}</span>
          </h1>
          <p className="text-sm text-(--color-ink-dim) mt-1.5">
            Here&apos;s what to focus on next.
          </p>
          {profile && profile.target_roles.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-(--color-ink-faint)">Targeting</span>
              {profile.target_roles.map((role) => (
                <span key={role} className="chip">{role}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-5 shrink-0">
          <ScoreRing value={home?.resume.avg_ats_score ?? 0} size={104} strokeWidth={7} label="ATS" />
          <div className="flex items-center gap-2 text-xs text-(--color-ink-faint)">
            <CalendarDays className="w-3.5 h-3.5" />
            {dateLabel}
          </div>
        </div>
      </Reveal>

      {isError && (
        <InlineError message="Could not load your dashboard. Check that the API is running and try again." />
      )}

      {isLoading && !isError && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[140px]" />)}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Skeleton className="h-[280px]" />
            <Skeleton className="h-[280px]" />
          </div>
        </div>
      )}

      {home && !isError && <DashboardContent home={home} />}

      {/* Co-branding. Placed at the foot of the page rather than the header:
          it is an attribution, not a product claim. */}
      <div className="flex items-center justify-center gap-2 border-t border-(--color-canvas-line) pt-5">
        <span className="h-1 w-1 rounded-full bg-(--color-ink-faint)" />
        <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-(--color-ink-faint)">
          Developed in collaboration with Chieac Organisation
        </span>
        <span className="h-1 w-1 rounded-full bg-(--color-ink-faint)" />
      </div>
    </div>
  );
}
