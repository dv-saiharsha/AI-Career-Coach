'use client'

import { Suspense, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Eye, EyeOff, ArrowRight } from 'lucide-react'
import { signIn } from '@/lib/authActions'
import { AuthCard, AuthAlert } from '@/components/auth/AuthCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { SocialAuthGrid } from '@/components/auth/SocialAuthGrid'

/* The callback route redirects here with ?error= when a provider flow fails.
   Mapped to human copy: the raw reason is for logs, not for the person. */
const OAUTH_ERRORS: Record<string, string> = {
  oauth_cancelled: 'Sign-in was cancelled. Nothing was created or changed.',
  oauth_failed: 'That provider could not complete sign-in. Try again, or use your email and password.',
  oauth_exchange_failed: 'We could not finish signing you in. Please try again.',
  auth_callback_failed: 'That sign-in link is invalid or has expired. Request a new one.',
}

export default function Login() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  /* Seeded from the URL rather than set in an effect, which would trip the
     set-state-in-effect rule and cause a cascading render. */
  const oauthError = searchParams.get('error')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>(oauthError ? 'error' : 'idle')
  const [error, setError] = useState(
    oauthError ? (OAUTH_ERRORS[oauthError] ?? OAUTH_ERRORS.oauth_failed) : ''
  )

  const from = searchParams.get('from') || '/jobs'
  const loading = status === 'loading'

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setStatus('loading')
    setError('')
    try {
      await signIn(email, password)
      router.replace(from)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not sign in. Check your email and password.'
      )
      setStatus('error')
    }
  }

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in to pick up where you left off."
      asideHeading="Everything is where you left it."
      asideTicker={[
        'Your scans are still scored.',
        'Your pipeline is still counted.',
        'Nothing was shared while you were away.',
      ]}
      asidePoints={[
        {
          title: 'Your scans have not expired',
          body: 'Every CV you have scored is still here, with the reasoning that produced each number.',
        },
        {
          title: 'Your pipeline kept counting',
          body: 'What you sent, when you sent it, and which ones have gone quiet since.',
        },
        {
          title: 'Nothing was shared',
          body: 'Your CV is not sold, listed, or shown to employers. It is read to score it, and that is all.',
        },
      ]}
      footer={
        <>
          No account yet?{' '}
          <Link
            href="/register"
            className="font-medium text-accent-text underline-offset-4 hover:underline outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          >
            Create one, free
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        <Field label="Email address" htmlFor="email" required>
          <Input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </Field>

        <Field label="Password" htmlFor="password" required>
          <Input
            id="password"
            type={showPassword ? 'text' : 'password'}
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            endAdornment={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                className="-mr-3 size-11"
              >
                {showPassword ? <EyeOff /> : <Eye />}
              </Button>
            }
          />
        </Field>

        <div className="-mt-1 flex justify-end">
          <Link
            href="/forgot-password"
            className="rounded text-[13px] text-ink-dim underline-offset-4 hover:text-ink hover:underline outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          >
            Forgot your password?
          </Link>
        </div>

        <AuthAlert>{status === 'error' && error ? error : null}</AuthAlert>

        {/* Button owns its own loading state, so the control never resizes
            mid-submit and there is no cross-fade to orchestrate. */}
        <Button
          type="submit"
          size="lg"
          loading={loading}
          loadingLabel="Signing in"
          className="mt-1 w-full"
        >
          {loading ? 'Signing in' : 'Sign in'}
          {!loading && <ArrowRight aria-hidden="true" />}
        </Button>
      </form>

      <SocialAuthGrid next={from} className="mt-7" />
    </AuthCard>
  )
}
