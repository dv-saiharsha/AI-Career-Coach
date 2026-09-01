'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { Reveal, RevealGroup } from '@/lib/reveal'
import { ArrowRight, Mail, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { ApplyCenterMark } from '../../components/ApplyCenterMark'
import { createClient } from '../../lib/supabase/client'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { SubmitButton, FormError } from '@/components/ui/form-parts'

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

      <RevealGroup className="w-full max-w-md relative z-10">
        <Reveal className="flex justify-center mb-8">
          <Link href="/" className="flex items-center gap-2.5">
            <ApplyCenterMark className="w-8 h-8" />
            <span className="wordmark font-semibold text-[var(--color-ink)] text-lg">ApplyCenter</span>
          </Link>
        </Reveal>

        <Reveal className="glass rounded-3xl p-8 shadow-[var(--shadow-pop)]">
          {status === 'sent' ? (
            <div className="text-center py-4">
              <div
                className="w-14 h-14 rounded-full bg-[var(--color-accent)]/15 border border-[var(--color-accent)]/25 flex items-center justify-center mx-auto mb-5 shadow-[0_0_24px_rgba(var(--glow-rgb),0.12)]"
              >
                <CheckCircle2 className="w-7 h-7 text-[var(--color-accent)]" />
              </div>
              <h1 className="text-xl font-display font-semibold text-[var(--color-ink)] mb-2">Check your email</h1>
              <p className="text-sm text-[var(--color-ink-dim)] mb-6">
                We sent a password reset link to <strong className="text-[var(--color-ink)]">{email}</strong>. Check your inbox and spam folder.
              </p>
              <Link href="/login" className="text-sm text-[var(--color-accent)] hover:text-[var(--color-accent-light)] transition-colors">
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-7">
                <h1 className="text-2xl font-display font-semibold text-[var(--color-ink)] mb-2">Reset password</h1>
                <p className="text-sm text-[var(--color-ink-dim)]">Enter your email and we&apos;ll send you a reset link.</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
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

                <FormError message={status === 'error' ? error : null} />

                <SubmitButton loading={status === 'loading'} loadingLabel="Sending…">
                  Send reset link
                  <ArrowRight className="size-4" />
                </SubmitButton>
              </form>
            </>
          )}
        </Reveal>

        <Reveal className="flex justify-center mt-6">
          <Link href="/login" className="flex items-center gap-1.5 text-sm text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to sign in
          </Link>
        </Reveal>
      </RevealGroup>
    </div>
  )
}
