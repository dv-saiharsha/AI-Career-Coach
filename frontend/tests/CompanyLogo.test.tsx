/**
 * The favicon never had a real bug — it's computed server-side
 * (job_market/services.py's company_logo_url) and arrives in the same
 * response as the rest of the job data, no separate round trip. The pop-in
 * complaint traced to `loading="lazy"` on a 36px thumbnail the user is
 * already looking at when the page paints: lazy-loading defers the request
 * until an intersection calculation completes, which is the right behaviour
 * for offscreen images and the textbook cause of visible pop-in for ones
 * that aren't offscreen at all.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CompanyLogo } from '@/components/jobs/CompanyLogo'

describe('CompanyLogo', () => {
  it('does not set loading="lazy" on a thumbnail that is visible on paint', () => {
    render(<CompanyLogo company="Acme" src="https://example.com/favicon.png" />)
    const img = document.querySelector('img')!
    expect(img).not.toHaveAttribute('loading', 'lazy')
  })

  it('shows the monogram immediately, never a blank box, while the real logo loads', () => {
    render(<CompanyLogo company="Acme" src="https://example.com/favicon.png" />)
    // Before onLoad fires, the letter must already be visible — the failure
    // this guards is a fully transparent box with nothing to look at at all.
    expect(screen.getByText('A')).toHaveClass('opacity-100')
  })

  it('cross-fades to the logo once it has actually painted, not on request start', () => {
    render(<CompanyLogo company="Acme" src="https://example.com/favicon.png" />)
    const img = document.querySelector('img')!
    expect(img).toHaveClass('opacity-0')

    fireEvent.load(img)
    expect(img).toHaveClass('opacity-100')
    expect(screen.getByText('A')).toHaveClass('opacity-0')
  })

  it('falls back to the monogram, staying visible, when the favicon 404s', () => {
    render(<CompanyLogo company="Acme" src="https://example.com/favicon.png" />)
    const img = document.querySelector('img')!

    fireEvent.error(img)

    expect(document.querySelector('img')).not.toBeInTheDocument()
    expect(screen.getByText('A')).toHaveClass('opacity-100')
  })

  it('skips the request entirely rather than firing one certain to fail', () => {
    render(<CompanyLogo company="Acme" src={null} />)
    expect(document.querySelector('img')).not.toBeInTheDocument()
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('takes the first letter of the company name for the fallback', () => {
    render(<CompanyLogo company="zeta corp" src={null} />)
    expect(screen.getByText('Z')).toBeInTheDocument()
  })
})
