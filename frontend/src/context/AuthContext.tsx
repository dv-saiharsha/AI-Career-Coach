import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export interface AuthUser {
  id: string
  email: string
  fullName: string
  avatarUrl: string | null
}

interface AuthContextValue {
  user: AuthUser | null
  session: Session | null
  ready: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, fullName: string) => Promise<void>
  loginWithGoogle: () => Promise<void>
  requestPasswordReset: (email: string) => Promise<void>
  logout: () => Promise<void>
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toAuthUser(session: Session): AuthUser {
  const { user } = session
  const meta = user.user_metadata ?? {}
  const fullName = str(meta.full_name) || str(meta.name) || user.email?.split('@')[0] || ''
  return {
    id: user.id,
    email: user.email ?? '',
    fullName,
    avatarUrl: str(meta.avatar_url) || str(meta.picture) || null,
  }
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Fires once immediately with the current session (INITIAL_SESSION), then
    // again on every login/logout/token refresh.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      setReady(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  const value: AuthContextValue = {
    session,
    user: session ? toAuthUser(session) : null,
    ready,
    login: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw new Error(error.message)
    },
    register: async (email, password, fullName) => {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      })
      if (error) throw new Error(error.message)
    },
    loginWithGoogle: async () => {
      // Full-page redirect: browser goes to Google, then to Supabase's own
      // callback, then back here at /auth/callback — that path (not
      // /dashboard) is what's allow-listed in Supabase's Authentication ->
      // URL Configuration -> Redirect URLs (see docs/oauth-setup.md).
      // AuthCallbackPage takes it from there once the session lands.
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      })
      if (error) throw new Error(error.message)
    },
    requestPasswordReset: async (email) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (error) throw new Error(error.message)
    },
    logout: async () => {
      await supabase.auth.signOut()
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
