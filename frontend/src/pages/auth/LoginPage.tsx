import React, { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { GoogleIcon } from '@/components/shared/GoogleIcon'
import { PasswordField } from '@/components/shared/PasswordField'
import { useAuth } from '@/context/AuthContext'

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, loginWithGoogle } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    try {
      await login(email, password)
      toast.success('Welcome back!')
      const redirectTo = (location.state as { from?: Location } | null)?.from?.pathname || '/dashboard'
      navigate(redirectTo, { replace: true })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not sign in.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleGoogleLogin = async () => {
    setIsGoogleLoading(true)
    try {
      await loginWithGoogle()
      // On success the browser is redirected away to Google, so nothing
      // more happens here — control only returns if the redirect itself failed.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start Google sign-in.')
      setIsGoogleLoading(false)
    }
  }

  return (
    <AuthLayout>
      <span className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-primary">Welcome back</span>
      <span className="mt-1.5 block h-px w-9 bg-primary/40" />
      <h2 className="mt-[9px] font-heading text-[30px] font-bold text-foreground">Sign in to HireLoom</h2>
      <p className="mb-[25px] mt-2 text-sm text-muted-foreground">Your next career move is waiting.</p>

      <Button
        type="button"
        variant="outline"
        className="h-[46px] w-full text-sm"
        onClick={handleGoogleLogin}
        disabled={isGoogleLoading || isLoading}
      >
        <GoogleIcon className="h-5 w-5" />
        {isGoogleLoading ? 'Redirecting to Google...' : 'Continue with Google'}
      </Button>

      <div className="my-[22px] flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-[11px] text-muted-foreground">or continue with email</span>
        <Separator className="flex-1" />
      </div>

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
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-[13px] font-semibold text-foreground">
              Password
            </Label>
            <Link to="/forgot-password" className="text-xs font-bold text-primary">
              Forgot password?
            </Link>
          </div>
          <PasswordField
            id="password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? 'Signing in...' : 'Sign in'}
        </Button>
      </form>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        New to HireLoom?{' '}
        <Link to="/signup" className="font-bold text-primary">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  )
}
