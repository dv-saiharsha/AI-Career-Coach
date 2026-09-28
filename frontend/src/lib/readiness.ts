import type { DashboardHomeSchema } from '@/types/dashboard'

/* A single 0-100 "career readiness" figure for the sidebar's mini widget.
   The backend has no one readiness field — this blends the two scores it
   does return (resume ATS score, already 0-100; interview average, 0-10).
   Dashboard's own readiness summary (Phase 2) should call this same helper
   rather than compute its own number, so the two never disagree. */
export function computeReadinessScore(data: DashboardHomeSchema | null | undefined): number {
  if (!data) return 0
  const resumeScore = data.resume.avg_ats_score ?? 0
  const interviewScore = (data.interview.average_score ?? 0) * 10
  const blended = resumeScore * 0.6 + interviewScore * 0.4
  return Math.min(100, Math.max(0, Math.round(blended)))
}
