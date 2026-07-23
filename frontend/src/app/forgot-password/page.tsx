'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowRight, Mail, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { ZenithMark } from '../../components/ZenithMark'
import { createClient } from '../../lib/supabase/client'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')
  const [error, setError] = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setStatus('loading')
    setError('')
    const supabase = createClient()
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    })
    if (resetError) {
      setError(resetError.message)
      setStatus('error')
      return
    }
    setStatus('sent')
  }

  return (
    <div className="min-h-screen bg-[var(--color-canvas)] flex items-center justify-center px-4 py-16 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[380px] bg-[var(--color-accent)]/8 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 right-[15%] w-[280px] h-[280px] bg-[var(--color-accent-light)]/5 rounded-full blur-[80px]" />
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
          className="flex justify-center mb-8"
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
          {status === 'sent' ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="text-center py-4"
            >
              <motion.div
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.1, ease: 'easeOut' }}
                className="w-14 h-14 rounded-full bg-[var(--color-accent)]/15 border border-[var(--color-accent)]/25 flex items-center justify-center mx-auto mb-5 shadow-[0_0_24px_rgba(var(--color-accent-rgb),0.25)]"
              >
                <CheckCircle2 className="w-7 h-7 text-[var(--color-accent)]" />
              </motion.div>
              <h1 className="text-xl font-display font-semibold text-[var(--color-ink)] mb-2">Check your email</h1>
              <p className="text-sm text-[var(--color-ink-dim)] mb-6">
                We sent a password reset link to <strong className="text-[var(--color-ink)]">{email}</strong>. Check your inbox and spam folder.
              </p>
              <Link href="/login" className="text-sm text-[var(--color-accent)] hover:text-[var(--color-accent-light)] transition-colors">
                Back to sign in
              </Link>
            </motion.div>
          ) : (
            <>
              <div className="mb-7">
                <h1 className="text-2xl font-display font-semibold text-[var(--color-ink)] mb-2">Reset password</h1>
                <p className="text-sm text-[var(--color-ink-dim)]">Enter your email and we&apos;ll send you a reset link.</p>
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
                      Sending...
                    </>
                  ) : (
                    <>
                      Send reset link
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            </>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="flex justify-center mt-6"
        >
          <Link href="/login" className="flex items-center gap-1.5 text-sm text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to sign in
          </Link>
        </motion.div>
      </div>
    </div>
  )
}
