import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Mail } from 'lucide-react'
import { toast } from 'sonner'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/context/AuthContext'

export function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const send = async () => {
    setIsLoading(true)
    try {
      await requestPasswordReset(email)
      setSent(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send reset email.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    send()
  }

  const handleResend = async () => {
    await send()
    toast.success('Reset email resent.')
  }

  return (
    <AuthLayout>
      {sent ? (
        <div className="text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-secondary text-primary">
            <Mail size={25} />
          </span>
          <h2 className="mt-[23px] font-heading text-[30px] font-bold text-foreground">Check your email</h2>
          <p className="mb-6 mt-3 text-[13px] text-muted-foreground">
            We sent a password reset link to <strong className="text-foreground">{email}</strong>. It will expire in
            30 minutes.
          </p>
          <Button className="w-full" onClick={handleResend} disabled={isLoading}>
            {isLoading ? 'Resending...' : 'Resend email'}
          </Button>
          <Link to="/login" className="mt-[22px] inline-flex items-center gap-1.5 text-xs font-bold text-primary">
            <ArrowLeft size={15} /> Back to sign in
          </Link>
        </div>
      ) : (
        <div className="max-w-[390px]">
          <span className="mb-[23px] grid h-12 w-12 place-items-center rounded-full bg-secondary text-primary">
            <ArrowLeft size={19} />
          </span>
          <span className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-primary">
            Account recovery
          </span>
          <span className="mt-1.5 block h-px w-9 bg-primary/40" />
          <h2 className="mt-[9px] font-heading text-[30px] font-bold text-foreground">Forgot your password?</h2>
          <p className="mb-[25px] mt-2 text-sm text-muted-foreground">
            No worries. Enter your email and we&rsquo;ll send you reset instructions.
          </p>
          <form onSubmit={handleSubmit} className="grid gap-[17px]">
            <div className="grid gap-2">
              <Label htmlFor="email" className="text-[13px] font-semibold text-foreground">
                Email address
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Sending...' : 'Send reset link'}
            </Button>
          </form>
          <Link
            to="/login"
            className="mt-6 flex items-center justify-center gap-1.5 text-xs font-bold text-primary"
          >
            <ArrowLeft size={15} /> Back to sign in
          </Link>
        </div>
      )}
    </AuthLayout>
  )
}
