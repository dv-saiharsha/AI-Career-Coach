'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Reveal, RevealGroup } from '@/lib/reveal'
import { ArrowRight, Lock, Eye, EyeOff, CheckCircle2 } from 'lucide-react'
import { ApplyCenterMark } from '../../components/ApplyCenterMark'
import { createClient } from '../../lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { SubmitButton, FormError } from '@/components/ui/form-parts'

export default function ResetPassword() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'done'>('idle')
  const [error, setError] = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      setStatus('error')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      setStatus('error')
      return
    }
    setStatus('loading')
    setError('')
    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setError(updateError.message)
      setStatus('error')
      return
    }
    setStatus('done')
    setTimeout(() => router.replace('/jobs'), 1500)
  }

  return (
    <div className="min-h-screen bg-[var(--color-canvas)] flex items-center justify-center px-4 py-16 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[380px] bg-[var(--color-accent)]/8 rounded-full blur-[120px]" />
      </div>

      <RevealGroup className="w-full max-w-md relative z-10">
        <Reveal className="flex justify-center mb-8">
          <Link href="/" className="flex items-center gap-2.5">
            <ApplyCenterMark className="w-8 h-8" />
            <span className="wordmark font-semibold text-[var(--color-ink)] text-lg">ApplyCenter</span>
          </Link>
        </Reveal>

        <Reveal className="glass rounded-3xl p-8 shadow-[var(--shadow-pop)]">
          {status === 'done' ? (
            <div className="text-center py-4">
              <div className="w-14 h-14 rounded-full bg-[var(--color-accent)]/15 border border-[var(--color-accent)]/25 flex items-center justify-center mx-auto mb-5">
                <CheckCircle2 className="w-7 h-7 text-[var(--color-accent)]" />
              </div>
              <h1 className="text-xl font-display font-semibold text-[var(--color-ink)] mb-2">Password updated</h1>
              <p className="text-sm text-[var(--color-ink-dim)]">Taking you to your jobs feed...</p>
            </div>
          ) : (
            <>
              <div className="mb-7">
                <h1 className="text-2xl font-display font-semibold text-[var(--color-ink)] mb-2">Set a new password</h1>
                <p className="text-sm text-[var(--color-ink-dim)]">Choose a new password for your account.</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <Field
                  label="New password"
                  htmlFor="password"
                  hint="At least 8 characters."
                  required
                >
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

                <Field
                  label="Confirm new password"
                  htmlFor="confirmPassword"
                  error={
                    confirmPassword.length > 0 && confirmPassword !== password
                      ? 'Passwords do not match.'
                      : undefined
                  }
                  required
                >
                  <Input
                    id="confirmPassword"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat your password"
                    invalid={confirmPassword.length > 0 && confirmPassword !== password}
                    startAdornment={<Lock />}
                  />
                </Field>

                <FormError message={status === 'error' ? error : null} />

                <SubmitButton loading={status === 'loading'} loadingLabel="Updating…">
                  Update password
                  <ArrowRight className="size-4" />
                </SubmitButton>
              </form>
            </>
          )}
        </Reveal>
      </RevealGroup>
    </div>
  )
}
