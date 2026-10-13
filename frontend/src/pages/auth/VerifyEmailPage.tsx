import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/context/AuthContext'
import { friendlyAuthError } from '@/lib/authErrors'

/** How long "Resend" stays disabled after a send. Firebase rate-limits
 * verification emails per account and answers a burst with too-many-requests, so
 * the button waits rather than inviting that error. */
const RESEND_COOLDOWN_SECONDS = 60

/** Minimum gap between the silent re-checks that run when the tab regains
 * focus, so flicking between tabs cannot hammer the sign-in service. */
const FOCUS_RECHECK_MS = 10_000

export function VerifyEmailPage() {
  const navigate = useNavigate()
  const { user, ready, resendVerificationEmail, refreshVerification, logout } = useAuth()
  const [cooldown, setCooldown] = useState(0)
  const [sending, setSending] = useState(false)
  const [checking, setChecking] = useState(false)
  const lastCheck = useRef(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const check = useCallback(
    async (announce: boolean) => {
      setChecking(true)
      lastCheck.current = Date.now()
      try {
        if (await refreshVerification()) {
          toast.success('Email verified. Welcome to HireLoom!')
          navigate('/dashboard', { replace: true })
        } else if (announce) {
          toast.info('Not verified yet. Open the link in the email we sent, then try again.')
        }
      } catch (err) {
        if (announce) toast.error(friendlyAuthError(err, 'Could not check your email status.'))
      } finally {
        setChecking(false)
      }
    },
    [navigate, refreshVerification]
  )

  // The usual path: the person opens the link in another tab, then comes back
  // to this one. Check once when they do, quietly.
  useEffect(() => {
    if (!user || user.emailVerified) return
    const onFocus = () => {
      if (Date.now() - lastCheck.current > FOCUS_RECHECK_MS) void check(false)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [user, check])

  if (!ready) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  if (user.emailVerified) return <Navigate to="/dashboard" replace />

  const resend = async () => {
    setSending(true)
    try {
      await resendVerificationEmail()
      setCooldown(RESEND_COOLDOWN_SECONDS)
      toast.success('Verification email sent.')
    } catch (err) {
      toast.error(friendlyAuthError(err, 'Could not send the email. Please try again in a moment.'))
    } finally {
      setSending(false)
    }
  }

  const useAnotherAccount = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <AuthLayout>
      <span className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-primary">Almost there</span>
      <span className="mt-1.5 block h-px w-9 bg-primary/40" />
      <h2 className="mt-[9px] font-heading text-[30px] font-bold text-foreground">Verify your email</h2>
      <p className="mb-[25px] mt-2 text-sm text-muted-foreground">
        We sent a verification link to <strong className="text-foreground">{user.email}</strong>. Open it, then come
        back here. It can take a minute to arrive; check your spam folder too.
      </p>

      <div className="grid gap-3">
        <Button type="button" className="w-full" onClick={() => void check(true)} disabled={checking}>
          {checking ? 'Checking...' : "I've verified my email"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => void resend()}
          disabled={sending || cooldown > 0}
        >
          {sending ? 'Sending...' : cooldown > 0 ? `Resend email (${cooldown}s)` : 'Resend verification email'}
        </Button>
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Wrong address?{' '}
        <button type="button" onClick={() => void useAnotherAccount()} className="font-bold text-primary">
          Sign out and use a different account
        </button>
      </p>
    </AuthLayout>
  )
}
