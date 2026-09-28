import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check } from 'lucide-react'
import { toast } from 'sonner'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { GoogleIcon } from '@/components/shared/GoogleIcon'
import { PasswordField } from '@/components/shared/PasswordField'
import { useAuth } from '@/context/AuthContext'
import { getPasswordStrength } from '@/lib/passwordStrength'
import { cn } from '@/lib/utils'

export function SignupPage() {
  const navigate = useNavigate()
  const { register, loginWithGoogle } = useAuth()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)

  const strength = getPasswordStrength(password)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!agreed) {
      toast.error('Please agree to the Terms of Service and Privacy Policy.')
      return
    }
    setIsLoading(true)
    try {
      await register(email, password, `${firstName} ${lastName}`.trim())
      toast.success('Account created! Welcome to HireLoom.')
      // There is no /onboarding route — a dedicated onboarding flow was never
      // built (needs a product decision on which backend fields it writes
      // to; see MIGRATION_PLAN.md). Route to the real dashboard instead of a
      // dead link.
      navigate('/dashboard')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create account.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleGoogleSignup = async () => {
    setIsGoogleLoading(true)
    try {
      await loginWithGoogle()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start Google sign-in.')
      setIsGoogleLoading(false)
    }
  }

  return (
    <AuthLayout>
      <span className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-primary">
        Start your next chapter
      </span>
      <span className="mt-1.5 block h-px w-9 bg-primary/40" />
      <h2 className="mt-[9px] font-heading text-[30px] font-bold text-foreground">Create your account</h2>
      <p className="mb-[25px] mt-2 text-sm text-muted-foreground">
        Build a career workflow that gets smarter with you.
      </p>

      <Button
        type="button"
        variant="outline"
        className="h-[46px] w-full text-sm"
        onClick={handleGoogleSignup}
        disabled={isGoogleLoading || isLoading}
      >
        <GoogleIcon className="h-5 w-5" />
        {isGoogleLoading ? 'Redirecting to Google...' : 'Continue with Google'}
      </Button>

      <div className="my-[22px] flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-[11px] text-muted-foreground">or sign up with email</span>
        <Separator className="flex-1" />
      </div>

      <form onSubmit={handleSubmit} className="grid gap-[17px]">
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label htmlFor="firstName" className="text-[13px] font-semibold text-foreground">
              First name
            </Label>
            <Input
              id="firstName"
              placeholder="Developer"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lastName" className="text-[13px] font-semibold text-foreground">
              Last name
            </Label>
            <Input
              id="lastName"
              placeholder="User"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
            />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="email" className="text-[13px] font-semibold text-foreground">
            Email address
          </Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password" className="text-[13px] font-semibold text-foreground">
            Password
          </Label>
          <PasswordField
            id="password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
          {password && (
            <div className="grid grid-cols-4 items-center gap-[5px]">
              {[0, 1, 2, 3].map((index) => (
                <span
                  key={index}
                  className={cn(
                    'h-1 rounded-full bg-border',
                    index < strength.segments && 'bg-success'
                  )}
                />
              ))}
              <small className="col-span-4 font-semibold text-success">{strength.label}</small>
            </div>
          )}
        </div>
        <label className="grid cursor-pointer grid-cols-[auto_1fr] items-start gap-2.5">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            required
          />
          <span className="grid h-[18px] w-[18px] place-items-center rounded-[5px] border border-border bg-card text-transparent peer-checked:border-primary peer-checked:bg-primary peer-checked:text-white">
            <Check size={13} />
          </span>
          <p className="m-0 text-[11px] leading-[1.55] text-muted-foreground">
            I agree to the <span className="font-semibold text-primary">Terms of Service</span> and{' '}
            <span className="font-semibold text-primary">Privacy Policy</span>.
          </p>
        </label>
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? 'Creating account...' : 'Create account'}
        </Button>
      </form>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Already have an account?{' '}
        <Link to="/login" className="font-bold text-primary">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  )
}
