/**
 * The four board groups, over the twelve backend stages.
 *
 * Duplicated from frontend/src/lib/applicationStages.ts rather than shared —
 * the two apps are separate packages — and the group ids are the contract
 * between them. If a stage moves group on the web, it moves here.
 *
 * The rule that matters is the same in both: a card already inside a group
 * keeps its precise stage. Moving a card to "Interviewing" when it is
 * already at Final Interview must not demote it to Recruiter Screening.
 */

export type ApplicationStatus =
  | 'saved'
  | 'applied'
  | 'recruiter_contacted'
  | 'recruiter_screening'
  | 'online_assessment'
  | 'technical_interview'
  | 'manager_interview'
  | 'final_interview'
  | 'offer'
  | 'accepted'
  | 'rejected'
  | 'withdrawn'

export type GroupId = 'wishlist' | 'applied' | 'interviewing' | 'offered'

export interface StageGroup {
  id: GroupId
  label: string
  entry: ApplicationStatus
  members: readonly ApplicationStatus[]
}

export const STAGE_GROUPS: readonly StageGroup[] = [
  { id: 'wishlist', label: 'Wishlist', entry: 'saved', members: ['saved'] },
  {
    id: 'applied',
    label: 'Applied',
    entry: 'applied',
    members: ['applied', 'recruiter_contacted'],
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
  },
  { id: 'offered', label: 'Offered', entry: 'offer', members: ['offer', 'accepted'] },
]

/* Closed applications sit in no group — the same call the web board makes.
   A board is for work in flight, and a rejection in a fifth column is
   something to scroll past every day. Both remain reachable from the
   action sheet. */
export const CLOSED_STAGES: readonly ApplicationStatus[] = ['rejected', 'withdrawn']

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

export function groupForStage(status: ApplicationStatus): StageGroup | null {
  return STAGE_GROUPS.find((g) => g.members.includes(status)) ?? null
}

/** The stage to persist when a card is moved to a group. */
export function stageForGroup(
  groupId: GroupId,
  currentStatus: ApplicationStatus,
): ApplicationStatus {
  const group = STAGE_GROUPS.find((g) => g.id === groupId)
  if (!group) return currentStatus
  return group.members.includes(currentStatus) ? currentStatus : group.entry
}
