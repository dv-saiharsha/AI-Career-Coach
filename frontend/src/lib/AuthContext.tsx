'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createClient } from './supabase/client'

export interface AuthUser {
  id: string
  email: string
  firstName: string
  lastName: string
  fullName: string
}

interface AuthContextValue {
  user: AuthUser | null
  ready: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, firstName: string, lastName: string) => Promise<void>
  logout: () => Promise<void>
  updateProfile: (fields: { firstName: string; lastName: string }) => Promise<void>
}

function toAuthUser(user: { id: string; email?: string; user_metadata?: Record<string, unknown> }): AuthUser {
  const meta = user.user_metadata ?? {}
  const firstName = typeof meta.first_name === 'string' ? meta.first_name : ''
  const lastName = typeof meta.last_name === 'string' ? meta.last_name : ''
  const fallback = user.email?.split('@')[0] ?? ''
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || fallback
  return { id: user.id, email: user.email ?? '', firstName: firstName || fallback, lastName, fullName }
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), [])
  const [user, setUser] = useState<AuthUser | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // onAuthStateChange fires once immediately with the current session
    // (INITIAL_SESSION), then again on every login/logout/token refresh —
    // this alone is enough to drive reactive UI state. The security-critical
    // check (getClaims(), signature-verified) happens in middleware.ts and
    // the protected layout, not here — this is just for display purposes.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ? toAuthUser(session.user) : null)
      setReady(true)
    })
    return () => subscription.unsubscribe()
  }, [supabase])

  const login = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message)
  }

  const register = async (email: string, password: string, firstName: string, lastName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: { first_name: firstName, last_name: lastName, full_name: `${firstName} ${lastName}`.trim() },
      },
    })
    if (error) throw new Error(error.message)
  }

  const logout = async () => {
    await supabase.auth.signOut()
  }

  const updateProfile = async ({ firstName, lastName }: { firstName: string; lastName: string }) => {
    const { data, error } = await supabase.auth.updateUser({
      data: { first_name: firstName, last_name: lastName, full_name: `${firstName} ${lastName}`.trim() },
    })
    if (error) throw new Error(error.message)
    if (data.user) setUser(toAuthUser(data.user))
  }

  return (
    <AuthContext.Provider value={{ user, ready, login, register, logout, updateProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
