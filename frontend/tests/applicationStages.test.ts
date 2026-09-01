import { describe, expect, it } from 'vitest'
import { APPLICATION_STAGES } from '@/lib/apiClient'
import {
  CLOSED_STAGES,
  STAGE_GROUPS,
  groupForStage,
  stageForDrop,
} from '@/lib/applicationStages'

/* The board shows four columns over a twelve-stage model. That mapping is
 * the kind of thing that silently rots — a stage added to the model and not
 * to a group would simply stop appearing on the board, with nothing failing.
 * And a wrong stageForDrop would rewrite a real application's stage on an
 * ordinary drag, which is data loss dressed as a UI bug. */

describe('board grouping', () => {
  it('accounts for every stage exactly once', () => {
    const grouped = STAGE_GROUPS.flatMap((g) => g.members)
    const covered = [...grouped, ...CLOSED_STAGES]

    expect(new Set(covered).size).toBe(covered.length) // no stage in two groups
    expect([...covered].sort()).toEqual([...APPLICATION_STAGES].sort())
  })

  it('puts every open stage in a column and every closed stage in none', () => {
    for (const group of STAGE_GROUPS) {
      for (const stage of group.members) {
        expect(groupForStage(stage)?.id).toBe(group.id)
      }
    }
    for (const stage of CLOSED_STAGES) {
      expect(groupForStage(stage)).toBeNull()
    }
  })

  it('uses a group entry stage that is a member of that group', () => {
    for (const group of STAGE_GROUPS) {
      expect(group.members).toContain(group.entry)
    }
  })

  it('keeps a precise stage when a card is dropped on its own column', () => {
    // The case that matters: Final Interview must not become Recruiter
    // Screening because someone nudged the card inside its own column.
    expect(stageForDrop('interviewing', 'final_interview')).toBe('final_interview')
    expect(stageForDrop('interviewing', 'technical_interview')).toBe('technical_interview')
    expect(stageForDrop('offered', 'accepted')).toBe('accepted')
  })

  it('takes the entry stage when a card moves in from another column', () => {
    expect(stageForDrop('interviewing', 'applied')).toBe('recruiter_screening')
    expect(stageForDrop('offered', 'final_interview')).toBe('offer')
    expect(stageForDrop('applied', 'saved')).toBe('applied')
    expect(stageForDrop('wishlist', 'offer')).toBe('saved')
  })

  it('brings a closed application back to the column it is dropped on', () => {
    expect(stageForDrop('interviewing', 'rejected')).toBe('recruiter_screening')
    expect(stageForDrop('applied', 'withdrawn')).toBe('applied')
  })

  it('never returns a stage outside the model', () => {
    for (const group of STAGE_GROUPS) {
      for (const from of APPLICATION_STAGES) {
        expect(APPLICATION_STAGES).toContain(stageForDrop(group.id, from))
      }
    }
  })
})
