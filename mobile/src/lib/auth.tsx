import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AppState } from 'react-native'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { authenticate, isBiometricLockEnabled } from './secureSession'
import { unregisterPush } from './notifications'

/**
 * Who is signed in, and whether the app is currently unlocked.
 *
 * Those are two different questions on a phone and only one of them exists
 * on the web. A session can be perfectly valid while the app should still be
 * showing a lock screen, because the device changed hands since it was last
 * open. `session` answers the first; `locked` answers the second.
 *
 * Supabase's onAuthStateChange is the source of truth for the session — it
 * fires once immediately with whatever is in the keychain, then on every
 * refresh — so there is no separate "restore on launch" path to keep
 * correct.
 */

interface AuthValue {
  session: Session | null
  ready: boolean
  locked: boolean
  unlock: () => Promise<boolean>
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, fullName: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

/** Re-lock after this long in the background. */
const LOCK_AFTER_MS = 60_000

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [locked, setLocked] = useState(false)

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setReady(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  /* Lock on return from the background, but only after a real absence.
     Locking on every blur means a biometric prompt every time someone
     glances at a notification, which trains them to turn the feature off. */
  useEffect(() => {
    let backgroundedAt: number | null = null

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        backgroundedAt = Date.now()
        return
      }
      if (state === 'active' && backgroundedAt) {
        const away = Date.now() - backgroundedAt
        backgroundedAt = null
        if (away < LOCK_AFTER_MS) return
        void isBiometricLockEnabled().then((enabled) => {
          if (enabled && session) setLocked(true)
        })
      }
    })
    return () => sub.remove()
  }, [session])

  const value = useMemo<AuthValue>(
    () => ({
      session,
      ready,
      locked,
      unlock: async () => {
        const ok = await authenticate('Unlock ApplyCenter')
        if (ok) setLocked(false)
        return ok
      },
      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw new Error(error.message)
      },
      signUp: async (email, password, fullName) => {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        })
        if (error) throw new Error(error.message)
      },
      signOut: async () => {
        /* Unregister before signing out: the call needs a valid token, and
           after signOut there is not one. */
        await unregisterPush()
        await supabase.auth.signOut()
        setLocked(false)
      },
    }),
    [session, ready, locked],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
