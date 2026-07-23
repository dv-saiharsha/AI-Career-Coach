'use client'

import { Suspense, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Eye, EyeOff, ArrowRight, Mail, Lock } from 'lucide-react'
import { useAuth } from '../../lib/AuthContext'
import { AuthShowcase } from '../../components/auth/AuthShowcase'
import { ZenithMark } from '../../components/ZenithMark'

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
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [error, setError] = useState('')

  const from = searchParams.get('from') || '/dashboard'

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setStatus('loading')
    setError('')
    try {
      await login(email, password)
      router.replace(from)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in. Check your email and password.')
      setStatus('error')
    }
  }

  return (
    <div className="min-h-screen bg-[var(--color-canvas)] grid lg:grid-cols-2">
      <AuthShowcase mode="login" />

      <div className="relative flex items-center justify-center px-4 py-16 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-[var(--color-accent)]/8 rounded-full blur-[120px]" />
          <div className="absolute bottom-1/4 left-[20%] w-[300px] h-[300px] bg-[var(--color-accent)]/5 rounded-full blur-[80px]" />
          <div
            className="absolute inset-0 opacity-[0.025]"
            style={{
              backgroundImage: 'linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)',
              backgroundSize: '60px 60px',
            }}
          />
        </div>

        <div className="w-full max-w-md relative z-10">
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex justify-center mb-8 lg:hidden"
        >
          <Link href="/" className="flex items-center gap-2.5">
            <ZenithMark className="w-8 h-8" />
            <span className="font-display font-semibold text-[var(--color-ink)] text-lg">Zenith</span>
          </Link>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="bg-[var(--color-canvas-raise)]/80 backdrop-blur-xl border border-[var(--color-canvas-line)] rounded-2xl p-8 shadow-[0_0_60px_rgba(0,0,0,0.5)]"
        >
          <div className="mb-7">
            <h1 className="text-2xl font-display font-semibold text-[var(--color-ink)] mb-2">Welcome back</h1>
            <p className="text-sm text-[var(--color-ink-dim)]">Sign in to your Zenith account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-mono uppercase tracking-widest text-[var(--color-ink-faint)] mb-2">
                Email address
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-ink-faint)]" />
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full bg-[var(--color-canvas)] border border-[var(--color-canvas-line)] rounded-xl pl-10 pr-4 py-3 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] transition-colors"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="password" className="block text-xs font-mono uppercase tracking-widest text-[var(--color-ink-faint)]">
                  Password
                </label>
                <Link href="/forgot-password" className="text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-light)] transition-colors">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-ink-faint)]" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-[var(--color-canvas)] border border-[var(--color-canvas-line)] rounded-xl pl-10 pr-10 py-3 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)] transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {status === 'error' && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 p-3 bg-[#EF4444]/10 border border-[#EF4444]/25 rounded-xl text-sm text-[#EF4444]"
              >
                {error}
              </motion.div>
            )}

            <button
              type="submit"
              disabled={status === 'loading'}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-dim)] text-white py-3 rounded-xl font-semibold text-sm hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(var(--color-accent-rgb),0.3)] mt-2"
            >
              {status === 'loading' ? (
                <>
                  <div className="w-4 h-4 border-2 border-[var(--color-on-accent)]/30 border-t-[var(--color-on-accent)] rounded-full animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-center text-sm text-[var(--color-ink-faint)] mt-6"
        >
          Don&apos;t have an account?{' '}
          <Link href="/register" className="text-[var(--color-accent)] hover:text-[var(--color-accent-light)] transition-colors font-medium">
            Create one free
          </Link>
        </motion.p>
        </div>
      </div>
    </div>
  )
}
