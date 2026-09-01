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

/* ────────────────────────────────────────────────────────────────────────
   BOARD GROUPS

   The model has twelve stages and the board shows four columns. Those are
   different jobs, not a disagreement: twelve is what an application record
   needs to be accurate — "Technical Interview" and "Final Interview" are not
   the same news — and four is what a board can show before it becomes a
   horizontal scroll of mostly-empty columns.

   So this is a presentation grouping and nothing else. No stage is removed,
   no row is rewritten, and every payload sent to the backend is still one of
   the twelve. Collapsing the model itself would throw away the distinction
   the Milestone 8 migration was written to capture.

   `entry` is the stage a card takes when it is dropped into a column from
   outside that column. It is the first stage of the group, which is the only
   honest guess available: dragging a card to "Interviewing" says a
   conversation started, not which round it reached. A card already inside
   the group keeps its precise stage — dropping it back on its own column
   must not silently demote it from Final Interview to Recruiter Screening.
   ──────────────────────────────────────────────────────────────────────── */

export interface StageGroup {
  id: 'wishlist' | 'applied' | 'interviewing' | 'offered'
  label: string
  /** The stage a card takes when dropped into this column from elsewhere. */
  entry: ApplicationStatus
  members: readonly ApplicationStatus[]
  marker: string
}

export const STAGE_GROUPS: readonly StageGroup[] = [
  {
    id: 'wishlist',
    label: 'Wishlist',
    entry: 'saved',
    members: ['saved'],
    marker: 'var(--color-ink-faint)',
  },
  {
    id: 'applied',
    label: 'Applied',
    entry: 'applied',
    members: ['applied', 'recruiter_contacted'],
    marker: 'var(--color-ink-dim)',
  },
  {
    id: 'interviewing',
    label: 'Interviewing',
    entry: 'recruiter_screening',
    members: [
      'recruiter_screening',
      'online_assessment',
      'technical_interview',
      'manager_interview',
      'final_interview',
    ],
    marker: 'var(--color-accent)',
  },
  {
    id: 'offered',
    label: 'Offered',
    entry: 'offer',
    members: ['offer', 'accepted'],
    marker: 'var(--color-signal-high)',
  },
]

/* rejected and withdrawn belong to no column on purpose. A board is for work
   in flight; a closed application sitting in a fifth column is a monument to
   a rejection the user has to scroll past every day. They remain first-class
   stages, reachable from the card's own status control and shown in the list
   view and the timeline. */
export const CLOSED_STAGES: readonly ApplicationStatus[] = ['rejected', 'withdrawn']

const GROUP_BY_STAGE = new Map<ApplicationStatus, StageGroup>(
  STAGE_GROUPS.flatMap((group) => group.members.map((stage) => [stage, group] as const)),
)

/** The column a stage belongs to, or null for a closed application. */
export function groupForStage(status: ApplicationStatus): StageGroup | null {
  return GROUP_BY_STAGE.get(status) ?? null
}

/**
 * The stage to persist when a card is dropped on a column.
 *
 * Returns the card's existing stage when it is already in that group, so a
 * drop that does not change columns never rewrites a precise stage into the
 * group's coarse entry point.
 */
export function stageForDrop(
  groupId: StageGroup['id'],
  currentStatus: ApplicationStatus,
): ApplicationStatus {
  const group = STAGE_GROUPS.find((g) => g.id === groupId)
  if (!group) return currentStatus
  return group.members.includes(currentStatus) ? currentStatus : group.entry
}
