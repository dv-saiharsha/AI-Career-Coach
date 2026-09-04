/**
 * The Apply button was unreachable — not hidden, not missing, but rendered
 * 66,000+ pixels below the viewport. Every protected route wraps its page
 * content in a `.route-enter` div for the page-transition animation, and
 * that animation's finished state computes as `transform:
 * matrix(1,0,0,1,0,0)` rather than the literal keyword `none` (confirmed
 * with getComputedStyle in a real browser, not assumed from the CSS
 * source). Any transform value other than `none` — an identity matrix
 * included — establishes a new containing block for `position: fixed`
 * descendants, so this drawer's "fixed" panel was silently computing its
 * height relative to the page's content box instead of the viewport.
 *
 * jsdom does not implement layout, so the pixel-height bug itself cannot be
 * reproduced here — that was verified against the real running app with
 * Playwright. What jsdom CAN pin is the actual fix: the drawer must render
 * through a portal to document.body, which is what takes it out of
 * .route-enter's subtree and off that broken containing-block chain
 * entirely — the same way every other overlay in this app (built on
 * Radix's Dialog primitive, see ui/sheet.tsx) already avoids this by
 * portaling for unrelated reasons.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { JobDetailDrawer, type JobPosting } from '@/components/jobs/JobDetailDrawer'

const JOB: JobPosting = {
  id: '1',
  title: 'Senior Financial Analyst',
  company: 'MongoDB',
  location: 'Cork, Ireland',
  workMode: 'On-site',
  salaryRange: 'Not disclosed',
  description: 'MongoDB is seeking a Senior Financial Analyst.',
  skills: [],
  postedDaysAgo: 0,
  applyUrl: 'https://www.mongodb.com/careers/job/?gh_jid=1',
  companyLogo: null,
  domain: null,
  h1bSponsorship: null,
  h1bEvidence: null,
  experienceLevel: null,
  employmentType: null,
}

function renderDrawer(props: Partial<Parameters<typeof JobDetailDrawer>[0]> = {}) {
  return render(
    <div data-testid="app-root">
      <JobDetailDrawer
        job={JOB}
        isOpen
        onClose={() => {}}
        onMatchResume={() => {}}
        onPracticeInterview={() => {}}
        {...props}
      />
    </div>
  )
}

describe('JobDetailDrawer', () => {
  it('renders outside the app root, not inline where it was originally mounted', () => {
    renderDrawer()
    const dialog = screen.getByRole('dialog')
    const appRoot = screen.getByTestId('app-root')

    expect(appRoot.contains(dialog)).toBe(false)
  })

  it('is a direct child of document.body', () => {
    renderDrawer()
    const dialog = screen.getByRole('dialog')

    expect(dialog.parentElement).toBe(document.body)
  })

  it('still renders the Apply action once portaled', () => {
    renderDrawer()
    expect(screen.getByRole('link', { name: /apply/i })).toHaveAttribute(
      'href',
      'https://www.mongodb.com/careers/job/?gh_jid=1'
    )
  })
})

describe('"Tailor my resume for this"', () => {
  /**
   * Used to always be a Link to /resume/tailor?job=<id> — a separate page
   * with its own pipeline, unrelated to Resume Analyzer's Quick Tailor and
   * unaware of the posting's real description. Resume Analyzer already had
   * everything needed to do this correctly (jobContext.ts stashes a job and
   * /resume's own useEffect reads it into `jobDescription` on mount — see
   * that file's tests) — "Match resume" already used it. Tailor simply
   * never called it. This wires it to the same mechanism instead of
   * building a second one.
   */
  it('calls onTailorResume with the job when provided, instead of navigating away', () => {
    const onTailorResume = vi.fn()
    renderDrawer({ onTailorResume })

    fireEvent.click(screen.getByRole('button', { name: /tailor my resume for this/i }))

    expect(onTailorResume).toHaveBeenCalledWith(JOB)
  })

  it('falls back to the old link when the handler is not wired', () => {
    renderDrawer({ onTailorResume: undefined })

    expect(screen.getByRole('link', { name: /tailor my resume for this/i })).toHaveAttribute(
      'href',
      '/resume/tailor?job=1'
    )
  })
})
