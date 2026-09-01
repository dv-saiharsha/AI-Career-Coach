'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createClient } from './supabase/client'

export interface AuthUser {
  id: string
  email: string
  firstName: string
  lastName: string
  fullName: string
  /** Google profile picture, when the account came in through OAuth. */
  avatarUrl: string | null
  /**
   * Auth providers actually linked to this account, straight from Supabase's
   * identities array — 'email', 'google', and so on. Read rather than
   * inferred: whether an account is connected to a provider is a fact the
   * session already carries, and a UI toggle that tracks it in local state
   * will claim "connected" for something that is not.
   */
  providers: string[]
}

interface AuthContextValue {
  user: AuthUser | null
  ready: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, firstName: string, lastName: string) => Promise<void>
  logout: () => Promise<void>
  updateProfile: (fields: { firstName: string; lastName: string }) => Promise<void>
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Resolve a display name across both sign-up paths.
 *
 * Email registration writes first_name/last_name, because our own form asks
 * for them. Google writes none of those — it sends full_name, name,
 * given_name and family_name — so reading only the first pair meant every
 * Google account fell through to the email local-part and a user who signed
 * in as "Venkata Sai Harshith Danda" was greeted as "venkata".
 *
 * Order matters: the names we were given whole are preferred over ones
 * reassembled from parts, and the email local-part is the last resort rather
 * than an equal option — it is a mailbox, not a name.
 */
function toAuthUser(user: {
  id: string
  email?: string
  user_metadata?: Record<string, unknown>
  identities?: { provider: string }[] | null
}): AuthUser {
  const meta = user.user_metadata ?? {}

  const given = str(meta.first_name) || str(meta.given_name)
  const family = str(meta.last_name) || str(meta.family_name)
  const whole = str(meta.full_name) || str(meta.name)
  const localPart = user.email?.split('@')[0] ?? ''

  const fullName = whole || [given, family].filter(Boolean).join(' ') || localPart

  // Derived from the full name when Google sent no given_name, so the avatar
  // initial is the first letter of the person's name rather than of their
  // email address.
  const firstName = given || fullName.split(' ')[0] || localPart
  const lastName = family || (whole ? whole.split(' ').slice(1).join(' ') : '')

  return {
    id: user.id,
    email: user.email ?? '',
    firstName,
    lastName,
    fullName,
    // Google uses `picture` on the raw OIDC claim and `avatar_url` once
    // Supabase has normalised it; which one is present depends on the
    // provider, so both are read.
    avatarUrl: str(meta.avatar_url) || str(meta.picture) || null,
    providers: (user.identities ?? []).map((i) => i.provider).filter(Boolean),
  }
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

  // Wrapped in useCallback (none of these close over `user`/`ready`, only
  // over `supabase` and setters, both already stable) so the context value
  // below can be memoized for real — otherwise every consumer of useAuth()
  // re-rendered on every AuthProvider render (e.g. each onAuthStateChange
  // tick), memoized or not, since a fresh function reference here would
  // have failed the memo's own equality check anyway.
  const login = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message)
  }, [supabase])

  const register = useCallback(async (email: string, password: string, firstName: string, lastName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: { first_name: firstName, last_name: lastName, full_name: `${firstName} ${lastName}`.trim() },
      },
    })
    if (error) throw new Error(error.message)
  }, [supabase])

  const logout = useCallback(async () => {
    // Cleared before the network call, not after. signOut() round-trips to
    // Supabase to revoke the refresh token, and until it returned the user
    // still saw their name, avatar and dashboard — a sign-out that visibly
    // does nothing for a second reads as broken, and on a shared machine it
    // reads as unsafe.
    setUser(null)

    // Hard navigation rather than router.push: a client-side transition keeps
    // React Query's cache alive, so the next signed-in user briefly sees the
    // previous one's resumes and applications before refetch replaces them.
    // Replacing the document drops every cache with it.
    try {
      await supabase.auth.signOut()
    } catch {
      // Already-expired sessions throw here. The local state is gone either
      // way, so failing loudly would only block the redirect.
    } finally {
      if (typeof window !== 'undefined') {
        window.location.assign('/login')
      }
    }
  }, [supabase])

  const updateProfile = useCallback(async ({ firstName, lastName }: { firstName: string; lastName: string }) => {
    const { data, error } = await supabase.auth.updateUser({
      data: { first_name: firstName, last_name: lastName, full_name: `${firstName} ${lastName}`.trim() },
    })
    if (error) throw new Error(error.message)
    if (data.user) setUser(toAuthUser(data.user))
  }, [supabase])

  const value = useMemo(
    () => ({ user, ready, login, register, logout, updateProfile }),
    [user, ready, login, register, logout, updateProfile],
  )

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
