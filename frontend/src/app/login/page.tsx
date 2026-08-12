'use client'

import { Suspense, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { Eye, EyeOff, ArrowRight, Mail, Lock, AlertCircle } from 'lucide-react'
import { useAuth } from '@/lib/AuthContext'
import { AuthShowcase } from '@/components/auth/AuthShowcase'
import { ZenithMark } from '@/components/ZenithMark'
import { AmbientGlow } from '@/components/ui/ambient-glow'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { SocialAuthGrid } from '@/components/auth/SocialAuthGrid'
import { ease, spring, springSoft } from '@/lib/motion'

/* The callback route redirects here with ?error= when a provider flow fails.
   Mapped to human copy: the raw reason is for logs, not for the person. */
const OAUTH_ERRORS: Record<string, string> = {
  oauth_cancelled: 'Sign-in was cancelled. No account was created or changed.',
  oauth_failed: 'That provider could not complete sign-in. Try again or use your email and password.',
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
  const { login } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  // Seeded from the URL rather than set in an effect, which would trip the
  // set-state-in-effect rule and cause a cascading render.
  const oauthError = searchParams.get('error')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>(
    oauthError ? 'error' : 'idle'
  )
  const [error, setError] = useState(
    oauthError ? (OAUTH_ERRORS[oauthError] ?? OAUTH_ERRORS.oauth_failed) : ''
  )

  const from = searchParams.get('from') || '/dashboard'
  const loading = status === 'loading'

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setStatus('loading')
    setError('')
    try {
      await login(email, password)
      router.replace(from)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not sign in. Check your email and password.'
      )
      setStatus('error')
    }
  }

  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-2">
      <AuthShowcase mode="login" />

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
              <ZenithMark className="size-8" />
              <span className="wordmark text-xl tracking-[-0.02em] text-ink">Zenith</span>
            </Link>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ ...springSoft, delay: 0.08 }}
            className="glass rounded-3xl p-8 shadow-[var(--shadow-pop)]"
          >
            <div className="mb-7">
              <h1 className="font-display text-3xl leading-tight tracking-[-0.025em] text-ink">
                Welcome back
              </h1>
              <p className="mt-2 text-sm text-ink-dim">Sign in to your Zenith account.</p>
            </div>

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
                  invalid={status === 'error'}
                  startAdornment={<Mail />}
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
                  placeholder="••••••••"
                  invalid={status === 'error'}
                  startAdornment={<Lock />}
                  endAdornment={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                      className="-mr-2 size-8"
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </Button>
                  }
                />
              </Field>

              <div className="-mt-2 flex justify-end">
                <Link
                  href="/forgot-password"
                  className="rounded text-[13px] text-ink-dim underline-offset-4 transition-colors hover:text-ink hover:underline"
                >
                  Forgot password?
                </Link>
              </div>

              {/* Form-level failure. Field-level problems surface inside Field. */}
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
                {/* Width is fixed by the button; only the contents cross-fade,
                    so the control never resizes mid-submit. */}
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
                      <Spinner className="text-on-accent" label="Signing in" />
                      Signing in…
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
                      Sign in
                      <ArrowRight className="size-4" />
                    </motion.span>
                  )}
                </AnimatePresence>
              </Button>
            </form>

              <SocialAuthGrid next={from} className="mt-6" />
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.28 }}
            className="mt-6 text-center text-sm text-ink-dim"
          >
            Don&apos;t have an account?{' '}
            <Link
              href="/register"
              className="font-medium text-ink underline-offset-4 transition-colors hover:underline"
            >
              Create one free
            </Link>
          </motion.p>
        </div>
      </div>
    </div>
  )
}
