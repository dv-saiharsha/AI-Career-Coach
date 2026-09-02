'use client'

import { Suspense, useMemo, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowRight, Eye, EyeOff, MailCheck } from 'lucide-react'
import { signUp } from '@/lib/authActions'
import { AuthCard, AuthAlert } from '@/components/auth/AuthCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { SocialAuthGrid } from '@/components/auth/SocialAuthGrid'

/* Scored off length alone. The bars and the word always agree, and the word
   is what carries the meaning for anyone who cannot separate the colours. */
const STRENGTH = [
  { label: '', color: 'var(--line)' },
  { label: 'Weak', color: 'var(--danger)' },
  { label: 'Good', color: 'var(--warning)' },
  { label: 'Strong', color: 'var(--success)' },
] as const

function scorePassword(pw: string) {
  if (pw.length === 0) return 0
  if (pw.length < 6) return 1
  if (pw.length < 10) return 2
  return 3
}

function PasswordToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={onToggle}
      aria-label={shown ? 'Hide password' : 'Show password'}
      aria-pressed={shown}
      className="-mr-3 size-11"
    >
      {shown ? <EyeOff /> : <Eye />}
    </Button>
  )
}

export default function Register() {
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  )
}

function RegisterForm() {
  const searchParams = useSearchParams()

  /* The landing hero posts here as a plain GET so its email field works with
     scripting off. Nothing was stored on the way; this just saves retyping. */
  const [email, setEmail] = useState(() => searchParams.get('email') ?? '')

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'sent'>('idle')
  const [error, setError] = useState('')

  const strength = scorePassword(password)
  const loading = status === 'loading'

  /* Validate as they type, but only complain about a field they have
     actually filled in. Nobody wants an error on an untouched input. */
  const passwordHint = useMemo(() => {
    if (!password) return 'At least 8 characters.'
    if (password.length < 8) {
      const left = 8 - password.length
      return left === 1 ? 'One more character.' : left + ' more characters.'
    }
    return undefined
  }, [password])

  const confirmError =
    confirmPassword.length > 0 && confirmPassword !== password ? 'These do not match.' : undefined

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (password !== confirmPassword) {
      setError('The two passwords do not match.')
      setStatus('error')
      return
    }
    if (password.length < 8) {
      setError('Your password needs to be at least 8 characters.')
      setStatus('error')
      return
    }
    setStatus('loading')
    setError('')
    try {
      await signUp(email, password, firstName.trim(), lastName.trim())
      /* Supabase requires email confirmation before a session exists, so
         there is no session to send them into the dashboard with yet. */
      setStatus('sent')
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not create the account. Try a different email.'
      )
      setStatus('error')
    }
  }

  if (status === 'sent') {
    return (
      <AuthCard title="Check your email" subtitle={'We sent a confirmation link to ' + email + '.'}>
        <div className="flex flex-col items-center gap-6 py-4 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-canvas field-ring">
            <MailCheck className="size-7 text-accent-text" strokeWidth={1.5} aria-hidden="true" />
          </span>
          <p className="max-w-[38ch] text-[14.5px] font-light leading-relaxed text-ink-dim">
            Open it and your account is ready. If it has not arrived in a few minutes, check the
            spam folder before trying again.
          </p>
          <Button asChild variant="secondary" size="lg" className="w-full">
            <Link href="/login">Back to sign in</Link>
          </Button>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Free, and it stays free. No card needed."
      asideHeading="Three things, from one upload."
      asideTicker={[
        'Upload a CV. Get the reasons, not just a score.',
        'Track every application in one place.',
        'Practise the interview before it happens.',
      ]}
      asidePoints={[
        {
          title: 'See your CV the way a filter does',
          body: 'A score, and underneath it the specific reasons — the missing skills, the bullets with no number in them.',
        },
        {
          title: 'Keep every application in one place',
          body: 'What you applied for, what stage it reached, and what is worth a follow-up this week.',
        },
        {
          title: 'Practise before the interview',
          body: 'Questions for the actual role and seniority, with written feedback on each answer.',
        },
      ]}
      footer={
        <>
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-medium text-accent-text underline-offset-4 hover:underline outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="First name" htmlFor="firstName" required>
            <Input
              id="firstName"
              required
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </Field>
          <Field label="Last name" htmlFor="lastName" required>
            <Input
              id="lastName"
              required
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </Field>
        </div>

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

        <Field label="Password" htmlFor="password" hint={passwordHint} required>
          <Input
            id="password"
            type={showPassword ? 'text' : 'password'}
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            endAdornment={
              <PasswordToggle shown={showPassword} onToggle={() => setShowPassword((v) => !v)} />
            }
          />
        </Field>

        {/* Strength: three inset grooves that fill, plus the word. The word
            is the part that still works without colour vision. */}
        {password.length > 0 && (
          <div className="-mt-2 flex items-center gap-3">
            <div className="flex flex-1 gap-1.5" aria-hidden="true">
              {[1, 2, 3].map((step) => (
                <span key={step} className="h-1.5 flex-1 rounded-full bg-canvas field-ring-soft">
                  <span
                    /* Fills across rather than switching on. A bar that
                       appears at full width reads as a result; one that grows
                       reads as a measurement responding to what is typed. */
                    className="block h-full origin-left rounded-full transition-[transform,background-color] duration-300 ease-(--ease-enter) motion-reduce:transition-none"
                    style={{
                      background: step <= strength ? STRENGTH[strength].color : 'transparent',
                      transform: step <= strength ? 'scaleX(1)' : 'scaleX(0)',
                    }}
                  />
                </span>
              ))}
            </div>
            <span className="text-micro text-ink-dim">{STRENGTH[strength].label}</span>
          </div>
        )}

        <Field label="Confirm password" htmlFor="confirmPassword" error={confirmError} required>
          <Input
            id="confirmPassword"
            type={showConfirmPassword ? 'text' : 'password'}
            required
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            invalid={Boolean(confirmError)}
            endAdornment={
              <PasswordToggle
                shown={showConfirmPassword}
                onToggle={() => setShowConfirmPassword((v) => !v)}
              />
            }
          />
        </Field>

        <AuthAlert>{status === 'error' && error ? error : null}</AuthAlert>

        <Button
          type="submit"
          size="lg"
          loading={loading}
          loadingLabel="Creating your account"
          className="mt-1 w-full"
        >
          {loading ? 'Creating your account' : 'Create account'}
          {!loading && <ArrowRight aria-hidden="true" />}
        </Button>
      </form>

      <SocialAuthGrid next="/jobs" className="mt-7" />
    </AuthCard>
  )
}
