'use client'

import axios from 'axios'
import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Eye, EyeOff, ArrowRight, Mail, Lock, CheckCircle2 } from 'lucide-react'
import { useAuth } from '../../lib/AuthContext'
import { AuthShowcase } from '../../components/auth/AuthShowcase'
import { useAccentPalette } from '../../lib/useAccentPalette'

export default function Register() {
  const { register } = useAuth()
  const router = useRouter()
  const palette = useAccentPalette()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [error, setError] = useState('')

  const passwordStrength = password.length === 0 ? 0 : password.length < 6 ? 1 : password.length < 10 ? 2 : 3
  const strengthLabels = ['', 'Weak', 'Good', 'Strong']
  const strengthColors = ['', '#EF4444', '#F59E0B', palette.accent]

  const handleSubmit = async (e: FormEvent) => {
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
      await register(email, password)
      router.replace('/dashboard')
    } catch (err) {
      const message = axios.isAxiosError(err) ? err.response?.data?.detail : null
      setError(message || 'Could not create account. Try a different email.')
      setStatus('error')
    }
  }

  return (
    <div className="min-h-screen bg-[var(--color-canvas)] grid lg:grid-cols-2">
      <AuthShowcase mode="register" />

      <div className="relative flex items-center justify-center px-4 py-16 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-[var(--color-accent)]/8 rounded-full blur-[120px]" />
          <div className="absolute bottom-0 right-[10%] w-[300px] h-[300px] bg-[var(--color-accent-light)]/5 rounded-full blur-[80px]" />
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
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[var(--color-accent)] to-[var(--color-accent-light)] shadow-[0_0_20px_rgba(var(--color-accent-rgb),0.4)]" />
            <span className="font-display font-semibold text-[var(--color-ink)] text-lg">AI Career Coach</span>
          </Link>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="bg-[var(--color-canvas-raise)]/80 backdrop-blur-xl border border-[var(--color-canvas-line)] rounded-2xl p-8 shadow-[0_0_60px_rgba(0,0,0,0.5)]"
        >
          <div className="mb-7">
            <h1 className="text-2xl font-display font-semibold text-[var(--color-ink)] mb-2">Claim your edge</h1>
            <p className="text-sm text-[var(--color-ink-dim)]">Free to start. No credit card. Just a sharper resume and a sharper interview.</p>
          </div>

          {/* Benefits */}
          <div className="flex flex-wrap gap-x-4 gap-y-2 mb-6 p-3 bg-[var(--color-accent)]/5 border border-[var(--color-accent)]/15 rounded-xl">
            {['Free to start', 'No credit card', 'Cancel anytime'].map((b) => (
              <div key={b} className="flex items-center gap-1.5 text-xs text-[var(--color-accent)]">
                <CheckCircle2 className="w-3 h-3 shrink-0" />
                {b}
              </div>
            ))}
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
              <label htmlFor="password" className="block text-xs font-mono uppercase tracking-widest text-[var(--color-ink-faint)] mb-2">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-ink-faint)]" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
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
              {password && (
                <div className="flex items-center gap-2 mt-2">
                  <div className="flex gap-1 flex-1">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="h-1 flex-1 rounded-full transition-all"
                        style={{ backgroundColor: i <= passwordStrength ? strengthColors[passwordStrength] : 'var(--color-canvas-line)' }}
                      />
                    ))}
                  </div>
                  <span className="text-xs" style={{ color: strengthColors[passwordStrength] }}>
                    {strengthLabels[passwordStrength]}
                  </span>
                </div>
              )}
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-xs font-mono uppercase tracking-widest text-[var(--color-ink-faint)] mb-2">
                Confirm Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-ink-faint)]" />
                <input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat your password"
                  className="w-full bg-[var(--color-canvas)] border border-[var(--color-canvas-line)] rounded-xl pl-10 pr-10 py-3 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)] transition-colors"
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
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
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Creating account...
                </>
              ) : (
                <>
                  Create free account
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            <p className="text-xs text-center text-[var(--color-ink-faint)]">
              By creating an account, you agree to our{' '}
              <Link href="#" className="text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] transition-colors">Terms of Service</Link>
              {' '}and{' '}
              <Link href="#" className="text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] transition-colors">Privacy Policy</Link>.
            </p>
          </form>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-center text-sm text-[var(--color-ink-faint)] mt-6"
        >
          Already have an account?{' '}
          <Link href="/login" className="text-[var(--color-accent)] hover:text-[var(--color-accent-light)] transition-colors font-medium">
            Sign in
          </Link>
        </motion.p>
        </div>
      </div>
    </div>
  )
}
