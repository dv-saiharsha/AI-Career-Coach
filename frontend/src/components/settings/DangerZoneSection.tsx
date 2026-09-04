'use client'

/**
 * Account deletion.
 *
 * This button was disabled, with a comment explaining that deletion needed
 * two things that did not exist: a cascade through every table the user
 * owns, and removal of the Supabase identity. Both exist now. A dialog that
 * ran a spinner with no request behind it would have been worse than the
 * disabled button — that reasoning was right, and it is why this only became
 * a real control once there was something real behind it.
 *
 * TYPE TO CONFIRM, NOT CLICK TO CONFIRM
 *
 * The API requires the literal string DELETE, and so does this form. A
 * second "are you sure?" button is answered by the same reflex that pressed
 * the first one; typing the word is a different action, and it is the last
 * point at which someone can notice they did not mean this.
 *
 * WHAT HAPPENS WHEN ONLY HALF OF IT WORKS
 *
 * The server erases rows first and the identity second, because the reverse
 * leaves a person unable to authenticate and therefore unable to retry. If
 * the second half fails it says so, and this component reports that plainly
 * rather than showing a success toast: their data really is gone, and their
 * login really does still work, and both halves of that need saying.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/AuthContext'
import { deleteMyAccount } from '@/lib/apiClient'

const CONFIRM_PHRASE = 'DELETE'

export function DangerZoneSection() {
  const router = useRouter()
  const { logout } = useAuth()
  const [phrase, setPhrase] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [partial, setPartial] = useState(false)

  const armed = phrase.trim() === CONFIRM_PHRASE

  const handleDelete = async () => {
    if (!armed) return
    setDeleting(true)
    setError(null)
    try {
      const result = await deleteMyAccount(CONFIRM_PHRASE)

      if (!result.sign_in_disabled) {
        /* Deliberately not treated as success. The rows are gone, so
           retrying would report zeroes and look like nothing happened — the
           honest thing is to say what is and is not done and stop. */
        setPartial(true)
        return
      }

      await logout()
      router.replace('/')
    } catch {
      setError('Could not delete your account. Nothing was removed — try again in a moment.')
    } finally {
      setDeleting(false)
    }
  }

  if (partial) {
    return (
      <div className="space-y-5">
        <h2 className="text-base font-semibold text-danger">Danger Zone</h2>
        <div
          role="alert"
          className="rounded-xl border border-danger/25 bg-danger/5 p-4"
        >
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">
            <AlertTriangle className="size-4 text-danger" aria-hidden="true" />
            Partly done
          </div>
          <p className="text-xs leading-relaxed text-ink-dim">
            Your data has been erased — profile, scans, applications and interview answers
            are gone and cannot be recovered. Removing your sign-in did not complete, so you
            can still log in to an empty account.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-ink-dim">
            Contact support and we will finish closing it. Nothing further is needed from
            you.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <h2 className="text-base font-semibold text-danger">Danger Zone</h2>

      <div className="rounded-xl border border-danger/20 bg-danger/5 p-4">
        <div className="mb-1 text-sm font-medium text-ink">Delete account</div>
        <p className="mb-4 text-xs leading-relaxed text-ink-dim">
          Permanently deletes your profile, every resume scan and stored CV, your
          applications and notes, your saved jobs and offers, and your interview sessions and
          answers. Your sign-in is removed too. This cannot be undone.
        </p>
        <p className="mb-4 text-xs leading-relaxed text-ink-dim">
          Want a copy first? Download your data from the Privacy section before continuing.
        </p>

        <div className="max-w-xs space-y-2">
          <Label htmlFor="confirm-delete" className="text-xs">
            Type <span className="font-mono font-semibold text-ink">{CONFIRM_PHRASE}</span> to
            confirm
          </Label>
          <Input
            id="confirm-delete"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder={CONFIRM_PHRASE}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="confirm-delete-help"
          />
          <p id="confirm-delete-help" className="text-xs text-ink-faint">
            The button stays disabled until this matches exactly.
          </p>
        </div>

        {error && (
          <p role="alert" className="mt-3 text-xs text-danger">
            {error}
          </p>
        )}

        <Button
          type="button"
          variant="outline"
          onClick={handleDelete}
          disabled={!armed}
          loading={deleting}
          loadingLabel="Deleting your account"
          className="mt-4 border-danger/25 bg-danger/10 text-danger"
        >
          {!deleting && <Trash2 />}
          {deleting ? 'Deleting…' : 'Delete my account'}
        </Button>
      </div>
    </div>
  )
}
