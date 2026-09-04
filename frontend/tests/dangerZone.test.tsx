/**
 * Account deletion, from the user's side.
 *
 * Two behaviours here are worth a test because getting either wrong is
 * damaging in a way no type checker sees.
 *
 * The confirmation gate, because the whole safety of an irreversible control
 * rests on it. A second "are you sure?" button is answered by the same
 * reflex that pressed the first; typing the word is a different action.
 *
 * And the partial failure. The server erases rows first and the sign-in
 * second, so the second half can fail with the data already gone. Treating
 * that as success would sign the person out and tell them their account is
 * closed, when in fact they can still log in — to an empty account. The
 * obvious implementation (`await logout()` on any 200) does exactly that.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const deleteMyAccount = vi.fn()
const logout = vi.fn()
const replace = vi.fn()

vi.mock('@/lib/apiClient', () => ({ deleteMyAccount: (c: string) => deleteMyAccount(c) }))
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ logout }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }))

import { DangerZoneSection } from '@/components/settings/DangerZoneSection'

const button = () => screen.getByRole('button', { name: /delete my account/i })
const field = () => screen.getByLabelText(/type .* to confirm/i)

describe('the confirmation gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deleteMyAccount.mockResolvedValue({ deleted: { profile: 1 }, sign_in_disabled: true })
  })

  it('is disabled until the word is typed exactly', () => {
    render(<DangerZoneSection />)
    expect(button()).toBeDisabled()

    fireEvent.change(field(), { target: { value: 'delete' } })
    expect(button(), 'lowercase should not arm an irreversible action').toBeDisabled()

    fireEvent.change(field(), { target: { value: 'DELETE ME' } })
    expect(button()).toBeDisabled()

    fireEvent.change(field(), { target: { value: 'DELETE' } })
    expect(button()).toBeEnabled()
  })

  it('sends nothing while disarmed', () => {
    render(<DangerZoneSection />)
    fireEvent.click(button())
    expect(deleteMyAccount).not.toHaveBeenCalled()
  })

  it('signs out and leaves the workspace once it succeeds', async () => {
    render(<DangerZoneSection />)
    fireEvent.change(field(), { target: { value: 'DELETE' } })
    fireEvent.click(button())

    await waitFor(() => expect(logout).toHaveBeenCalled())
    expect(deleteMyAccount).toHaveBeenCalledWith('DELETE')
    expect(replace).toHaveBeenCalledWith('/')
  })
})

describe('when only the data half succeeded', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deleteMyAccount.mockResolvedValue({ deleted: { profile: 1 }, sign_in_disabled: false })
  })

  it('does not sign the user out or claim the account is closed', async () => {
    render(<DangerZoneSection />)
    fireEvent.change(field(), { target: { value: 'DELETE' } })
    fireEvent.click(button())

    await screen.findByRole('alert')
    expect(logout, 'signed out of an account that still exists').not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  it('says both halves of the truth', async () => {
    render(<DangerZoneSection />)
    fireEvent.change(field(), { target: { value: 'DELETE' } })
    fireEvent.click(button())

    const alert = await screen.findByRole('alert')
    // Their data is gone...
    expect(alert.textContent).toMatch(/erased|gone/i)
    // ...and their login is not.
    expect(alert.textContent).toMatch(/still log in/i)
  })

  it('does not offer a retry that would report zeroes', async () => {
    /* The rows are already deleted. A second attempt returns all-zero counts
       and reads as "nothing happened", which is the opposite of the truth. */
    render(<DangerZoneSection />)
    fireEvent.change(field(), { target: { value: 'DELETE' } })
    fireEvent.click(button())

    await screen.findByRole('alert')
    expect(screen.queryByRole('button', { name: /delete my account/i })).not.toBeInTheDocument()
  })
})

describe('when the request itself fails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deleteMyAccount.mockRejectedValue(new Error('network'))
  })

  it('keeps the user signed in and says nothing was removed', async () => {
    render(<DangerZoneSection />)
    fireEvent.change(field(), { target: { value: 'DELETE' } })
    fireEvent.click(button())

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/nothing was removed/i)
    expect(logout).not.toHaveBeenCalled()
  })
})
