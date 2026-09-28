import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { PasswordField } from '@/components/shared/PasswordField'
import { supabase } from '@/lib/supabase'

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [done, setDone] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      toast.error('Passwords do not match.')
      return
    }

    setIsLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setIsLoading(false)

    if (error) {
      toast.error(error.message)
      return
    }
    setDone(true)
    setTimeout(() => navigate('/dashboard'), 1500)
  }

  return (
    <AuthLayout>
      {done ? (
        <div className="text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-success-tint text-success">
            <CheckCircle2 size={25} />
          </span>
          <h2 className="mt-[23px] font-heading text-[30px] font-bold text-foreground">Password updated</h2>
          <p className="mt-3 text-[13px] text-muted-foreground">Taking you to your dashboard...</p>
        </div>
      ) : (
        <>
          <span className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-primary">
            Account recovery
          </span>
          <span className="mt-1.5 block h-px w-9 bg-primary/40" />
          <h2 className="mt-[9px] font-heading text-[30px] font-bold text-foreground">Set a new password</h2>
          <p className="mb-[25px] mt-2 text-sm text-muted-foreground">Choose a new password for your account.</p>
          <form onSubmit={handleSubmit} className="grid gap-[17px]">
            <div className="grid gap-2">
              <Label htmlFor="password" className="text-[13px] font-semibold text-foreground">
                New password
              </Label>
              <PasswordField
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="confirmPassword" className="text-[13px] font-semibold text-foreground">
                Confirm password
              </Label>
              <PasswordField
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Updating...' : 'Update password'}
            </Button>
          </form>
        </>
      )}
    </AuthLayout>
  )
}
