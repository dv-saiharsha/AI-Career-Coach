'use client'

import { useMemo, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import { Eye, EyeOff, ArrowRight, Mail, Lock, CheckCircle2, User, AlertCircle } from 'lucide-react'
import { useAuth } from '@/lib/AuthContext'
import { AuthShowcase } from '@/components/auth/AuthShowcase'
import { ApplyCenterMark } from '@/components/ApplyCenterMark'
import { AmbientGlow } from '@/components/ui/ambient-glow'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { SocialAuthGrid } from '@/components/auth/SocialAuthGrid'
import { ease, spring, springSoft, springSnappy } from '@/lib/motion'

/* Strength is scored off length only, matching the original behaviour — the
   bars and the word always agree, and the word is what carries the meaning
   for anyone who cannot separate the bar colours. */
const STRENGTH = [
  { label: '', color: 'var(--canvas-line)' },
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

function PasswordToggle({
  shown,
  onToggle,
}: {
  shown: boolean
  onToggle: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={onToggle}
      aria-label={shown ? 'Hide password' : 'Show password'}
      aria-pressed={shown}
      className="-mr-2 size-8"
    >
      {shown ? <EyeOff /> : <Eye />}
    </Button>
  )
}

export default function Register() {
  const { register } = useAuth()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'sent'>('idle')
  const [error, setError] = useState('')

  const strength = scorePassword(password)
  const loading = status === 'loading'

  /* Validate as the user types, but only complain about a field they have
     actually filled in — nobody wants an error on an untouched input. */
  const passwordHint = useMemo(() => {
    if (!password) return 'At least 8 characters.'
    if (password.length < 8) return `${8 - password.length} more character(s) needed.`
    return undefined
  }, [password])

  const confirmError =
    confirmPassword.length > 0 && confirmPassword !== password
      ? 'Passwords do not match.'
      : undefined

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      setStatus('error')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      setStatus('error')
      return
    }
    setStatus('loading')
    setError('')
    try {
      await register(email, password, firstName.trim(), lastName.trim())
      // Supabase requires email confirmation before a session exists — no
      // active session to send them into /dashboard with yet.
      setStatus('sent')
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not create account. Try a different email.'
      )
      setStatus('error')
    }
  }

  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-2">
      <AuthShowcase mode="register" />

      <div className="grain relative flex items-center justify-center overflow-hidden px-4 py-16">
        <AmbientGlow />

        <div className="relative z-10 w-full max-w-md">
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springSoft}
            className="mb-8 flex justify-center lg:hidden"
          >
            <Link href="/" className="flex items-center gap-2.5">
              <ApplyCenterMark className="size-8" />
              <span className="wordmark text-xl tracking-[-0.02em] text-ink">ApplyCenter</span>
            </Link>
          </motion.div>

          <motion.div
            layout
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ ...springSoft, delay: 0.08 }}
            className="glass rounded-3xl p-8 shadow-[var(--shadow-pop)]"
          >
            <AnimatePresence mode="wait" initial={false}>
              {status === 'sent' ? (
                <motion.div
                  key="sent"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={springSoft}
                  className="py-4 text-center"
                >
                  <motion.div
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ ...spring, delay: 0.1 }}
                    className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full border border-success/25 bg-success/12"
                  >
                    <CheckCircle2 className="size-7 text-success" aria-hidden="true" />
                  </motion.div>
                  <h1 className="font-display text-2xl tracking-[-0.02em] text-ink">
                    Check your email
                  </h1>
                  <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-ink-dim">
                    We sent a confirmation link to{' '}
                    <strong className="font-medium text-ink">{email}</strong>. Click it to activate
                    your account and sign in.
                  </p>
                  <Button asChild variant="outline" className="mt-6">
                    <Link href="/login">Back to sign in</Link>
                  </Button>
                </motion.div>
              ) : (
                <motion.div
                  key="form"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={ease}
                >
                  <div className="mb-6">
                    <h1 className="font-display text-3xl leading-tight tracking-[-0.025em] text-ink">
                      Claim your edge
                    </h1>
                    <p className="mt-2 text-sm leading-relaxed text-ink-dim">
                      Free to start. No credit card. Just a sharper resume and a sharper interview.
                    </p>
                  </div>

                  <ul className="mb-6 flex flex-wrap gap-x-4 gap-y-2 rounded-xl border border-canvas-line bg-canvas-elevated/60 p-3">
                    {['Free to start', 'No credit card', 'Cancel anytime'].map((b) => (
                      <li key={b} className="flex items-center gap-1.5 text-xs text-ink-subtle">
                        <CheckCircle2 className="size-3 shrink-0 text-success" aria-hidden="true" />
                        {b}
                      </li>
                    ))}
                  </ul>

                  <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <Field label="First name" htmlFor="firstName" required>
                        <Input
                          id="firstName"
                          required
                          autoComplete="given-name"
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          placeholder="John"
                          startAdornment={<User />}
                        />
                      </Field>
                      <Field label="Last name" htmlFor="lastName" required>
                        <Input
                          id="lastName"
                          required
                          autoComplete="family-name"
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          placeholder="Doe"
                          startAdornment={<User />}
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
                        startAdornment={<Mail />}
                      />
                    </Field>

                    <div>
                      <Field label="Password" htmlFor="password" hint={passwordHint} required>
                        <Input
                          id="password"
                          type={showPassword ? 'text' : 'password'}
                          required
                          autoComplete="new-password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="At least 8 characters"
                          startAdornment={<Lock />}
                          endAdornment={
                            <PasswordToggle
                              shown={showPassword}
                              onToggle={() => setShowPassword((v) => !v)}
                            />
                          }
                        />
                      </Field>

                      <AnimatePresence initial={false}>
                        {password && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={ease}
                            className="mt-2 flex items-center gap-2 overflow-hidden"
                          >
                            <div className="flex flex-1 gap-1" aria-hidden="true">
                              {[1, 2, 3].map((i) => (
                                <motion.span
                                  key={i}
                                  className="h-1 flex-1 rounded-full"
                                  initial={false}
                                  animate={{
                                    backgroundColor:
                                      i <= strength
                                        ? STRENGTH[strength].color
                                        : 'var(--canvas-line)',
                                  }}
                                  transition={springSnappy}
                                />
                              ))}
                            </div>
                            <span
                              className="text-xs font-medium"
                              style={{ color: STRENGTH[strength].color }}
                            >
                              {STRENGTH[strength].label}
                            </span>
                            <span className="sr-only" aria-live="polite">
                              Password strength: {STRENGTH[strength].label || 'none'}
                            </span>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    <Field
                      label="Confirm password"
                      htmlFor="confirmPassword"
                      error={confirmError}
                      required
                    >
                      <Input
                        id="confirmPassword"
                        type={showConfirmPassword ? 'text' : 'password'}
                        required
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Repeat your password"
                        invalid={Boolean(confirmError)}
                        startAdornment={<Lock />}
                        endAdornment={
                          <PasswordToggle
                            shown={showConfirmPassword}
                            onToggle={() => setShowConfirmPassword((v) => !v)}
                          />
                        }
                      />
                    </Field>

                    <AnimatePresence initial={false}>
                      {status === 'error' && error && (
                        <motion.p
                          role="alert"
                          initial={{ opacity: 0, height: 0, y: -6 }}
                          animate={{ opacity: 1, height: 'auto', y: 0 }}
                          exit={{ opacity: 0, height: 0, y: -6 }}
                          transition={ease}
                          className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/10 p-3 text-sm text-danger"
                        >
                          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                          {error}
                        </motion.p>
                      )}
                    </AnimatePresence>

                    <Button type="submit" size="lg" disabled={loading} className="mt-1 w-full">
                      <AnimatePresence mode="wait" initial={false}>
                        {loading ? (
                          <motion.span
                            key="loading"
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={spring}
                            className="inline-flex items-center gap-2"
                          >
                            <Spinner className="text-on-accent" label="Creating account" />
                            Creating account…
                          </motion.span>
                        ) : (
                          <motion.span
                            key="idle"
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={spring}
                            className="inline-flex items-center gap-2"
                          >
                            Create free account
                            <ArrowRight className="size-4" />
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </Button>

                    <p className="text-center text-xs leading-relaxed text-ink-faint">
                      By creating an account, you agree to our{' '}
                      <Link href="#" className="text-ink-dim underline-offset-4 hover:text-ink hover:underline">
                        Terms of Service
                      </Link>{' '}
                      and{' '}
                      <Link href="#" className="text-ink-dim underline-offset-4 hover:text-ink hover:underline">
                        Privacy Policy
                      </Link>
                      .
                    </p>
                  </form>

                  <SocialAuthGrid dividerLabel="or sign up with" className="mt-6" />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.28 }}
            className="mt-6 text-center text-sm text-ink-dim"
          >
            Already have an account?{' '}
            <Link
              href="/login"
              className="font-medium text-ink underline-offset-4 transition-colors hover:underline"
            >
              Sign in
            </Link>
          </motion.p>
        </div>
      </div>
    </div>
  )
}
