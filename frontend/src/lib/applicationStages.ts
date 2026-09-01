import type { ApplicationStatus } from './apiClient'
import { APPLICATION_STAGES } from './apiClient'

export { APPLICATION_STAGES }

export const STAGE_LABELS: Record<ApplicationStatus, string> = {
  saved: 'Saved',
  applied: 'Applied',
  recruiter_contacted: 'Recruiter Contacted',
  recruiter_screening: 'Recruiter Screening',
  online_assessment: 'Online Assessment',
  technical_interview: 'Technical Interview',
  manager_interview: 'Manager Interview',
  final_interview: 'Final Interview',
  offer: 'Offer',
  accepted: 'Accepted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
}

// Signal tokens, not chroma. The palette carries no per-stage hues;
// progression through the pipeline is carried by column order, with colour
// reserved for the stages that are genuinely outcomes — an offer/acceptance
// reads as positive, a rejection as negative, a withdrawal as a neutral exit
// the candidate chose rather than one that happened to them.
export const STAGE_MARKERS: Record<ApplicationStatus, string> = {
  saved: 'var(--color-ink-faint)',
  applied: 'var(--color-ink-dim)',
  recruiter_contacted: 'var(--color-ink-dim)',
  recruiter_screening: 'var(--color-accent)',
  online_assessment: 'var(--color-accent)',
  technical_interview: 'var(--color-accent)',
  manager_interview: 'var(--color-accent)',
  final_interview: 'var(--color-accent)',
  offer: 'var(--color-signal-high)',
  accepted: 'var(--color-signal-high)',
  rejected: 'var(--color-signal-low)',
  withdrawn: 'var(--color-ink-faint)',
}

export function stageLabel(status: ApplicationStatus): string {
  return STAGE_LABELS[status] ?? status
}
