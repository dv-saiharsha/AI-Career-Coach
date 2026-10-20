import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AuthErrorCodes,
  EmailAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  linkWithCredential,
  onAuthStateChanged,
  reauthenticateWithCredential,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  updateProfile,
  verifyBeforeUpdateEmail,
  type AuthCredential,
  type User,
} from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { errorCode, isCancelled } from '@/lib/authErrors'

export type AuthProviderName = 'google' | 'password'

export interface AuthUser {
  id: string
  email: string
  fullName: string
  avatarUrl: string | null
  /** False for an email/password account until the address has been confirmed.
   * The API refuses these users (403 email_not_verified), so the app routes
   * them to /verify-email instead of letting them hit that wall. */
  emailVerified: boolean
  providers: AuthProviderName[]
  /** ISO timestamp, or null if Firebase did not report one. */
  createdAt: string | null
}

export type GoogleOutcome = 'signed-in' | 'cancelled'

/** Google sign-in reached an email that already belongs to a different sign-in
 * method. The person must prove they own that account (by signing in with it)
 * before Google can be linked to it. */
export class AccountExistsError extends Error {
  constructor(public readonly email: string) {
    super('An account with this email already exists.')
    this.name = 'AccountExistsError'
  }
}

interface AuthContextValue {
  user: AuthUser | null
  ready: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, fullName: string) => Promise<void>
  loginWithGoogle: () => Promise<GoogleOutcome>
  /** Set while a Google sign-in is waiting to be linked to an existing account. */
  pendingGoogleLinkEmail: string | null
  /** Sign in to the existing account with its password, then link the pending Google identity. */
  completeGoogleLink: (password: string) => Promise<void>
  cancelGoogleLink: () => void
  requestPasswordReset: (email: string) => Promise<void>
  resendVerificationEmail: () => Promise<void>
  /** Re-reads the account and mints a fresh token. Returns whether the email is now verified. */
  refreshVerification: () => Promise<boolean>
  updateDisplayName: (fullName: string) => Promise<void>
  /** Sends a confirmation link to the new address; the email changes once it is followed. */
  changeEmail: (newEmail: string, currentPassword: string) => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  logout: () => Promise<void>
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toAuthUser(user: User): AuthUser {
  const providers = user.providerData
    .map((p) => (p.providerId === 'google.com' ? 'google' : p.providerId === 'password' ? 'password' : null))
    .filter((p): p is AuthProviderName => p !== null)
  return {
    id: user.uid,
    email: user.email ?? '',
    fullName: str(user.displayName) || user.email?.split('@')[0] || '',
    avatarUrl: str(user.photoURL) || null,
    emailVerified: user.emailVerified,
    providers,
    createdAt: user.metadata.creationTime ? new Date(user.metadata.creationTime).toISOString() : null,
  }
}

/** Where verification and reset links send the person once Firebase's own page is done. */
function continueUrl(): string {
  return `${window.location.origin}/dashboard`
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null)
  // Bumped after reload()/updateProfile(), which mutate the User object in
  // place without Firebase emitting a new auth state, so React would not
  // otherwise notice that emailVerified or displayName changed.
  const [version, setVersion] = useState(0)
  const [ready, setReady] = useState(false)
  const [pendingGoogleLinkEmail, setPendingGoogleLinkEmail] = useState<string | null>(null)
  // Held in a ref, not state: a credential is a secret-bearing object with no
  // business being rendered, serialised or kept in React DevTools state.
  const pendingCredential = useRef<AuthCredential | null>(null)

  useEffect(() => {
    // Fires once with the restored session (or null), then on every sign-in
    // and sign-out.
    return onAuthStateChanged(auth, (next) => {
      setFirebaseUser(next)
      setReady(true)
    })
  }, [])

  const bump = useCallback(() => setVersion((v) => v + 1), [])

  const user = useMemo(
    () => (firebaseUser ? toAuthUser(firebaseUser) : null),
    // `version` is intentionally a dependency: see its comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [firebaseUser, version]
  )

  const requireUser = (): User => {
    const current = auth.currentUser
    if (!current) throw new Error('You are signed out. Sign in again.')
    return current
  }

  const value: AuthContextValue = {
    user,
    ready,
    pendingGoogleLinkEmail,

    login: async (email, password) => {
      await signInWithEmailAndPassword(auth, email.trim(), password)
    },

    register: async (email, password, fullName) => {
      const { user: created } = await createUserWithEmailAndPassword(auth, email.trim(), password)
      if (fullName) await updateProfile(created, { displayName: fullName })
      // The account exists from here on. A failure to send the email must not
      // read as a failed signup: the verify page has a resend button.
      try {
        await sendEmailVerification(created, { url: continueUrl() })
      } catch {
        /* surfaced by the verify page's resend */
      }
      bump()
    },

    loginWithGoogle: async () => {
      try {
        await signInWithPopup(auth, new GoogleAuthProvider())
        return 'signed-in'
      } catch (err) {
        if (isCancelled(err)) return 'cancelled'
        if (errorCode(err) === AuthErrorCodes.NEED_CONFIRMATION) {
          const credential = GoogleAuthProvider.credentialFromError(err as Parameters<typeof GoogleAuthProvider.credentialFromError>[0])
          const email = (err as { customData?: { email?: string } }).customData?.email
          if (credential && email) {
            pendingCredential.current = credential
            setPendingGoogleLinkEmail(email)
            throw new AccountExistsError(email)
          }
        }
        throw err
      }
    },

    completeGoogleLink: async (password) => {
      const credential = pendingCredential.current
      const email = pendingGoogleLinkEmail
      if (!credential || !email) throw new Error('There is no Google sign-in waiting to be linked.')
      const { user: existing } = await signInWithEmailAndPassword(auth, email, password)
      await linkWithCredential(existing, credential)
      pendingCredential.current = null
      setPendingGoogleLinkEmail(null)
      bump()
    },

    cancelGoogleLink: () => {
      pendingCredential.current = null
      setPendingGoogleLinkEmail(null)
    },

    requestPasswordReset: async (email) => {
      await sendPasswordResetEmail(auth, email.trim(), { url: `${window.location.origin}/login` })
    },

    resendVerificationEmail: async () => {
      await sendEmailVerification(requireUser(), { url: continueUrl() })
    },

    refreshVerification: async () => {
      const current = requireUser()
      await reload(current)
      // emailVerified is also a claim inside the ID token the API checks, and
      // a token is reused until it is nearly expired. Without forcing a new
      // one the API would keep refusing the person for up to an hour after they
      // had verified.
      await current.getIdToken(true)
      bump()
      return current.emailVerified
    },

    updateDisplayName: async (fullName) => {
      await updateProfile(requireUser(), { displayName: fullName })
      bump()
    },

    changeEmail: async (newEmail, currentPassword) => {
      const current = requireUser()
      if (!current.email) throw new Error('This account has no email address to change.')
      // Changing an email is one of the actions Firebase requires a recent
      // sign-in for, so prove the password again instead of failing later.
      await reauthenticateWithCredential(current, EmailAuthProvider.credential(current.email, currentPassword))
      await verifyBeforeUpdateEmail(current, newEmail.trim(), { url: continueUrl() })
    },

    changePassword: async (currentPassword, newPassword) => {
      const current = requireUser()
      if (!current.email) throw new Error('This account has no email address.')
      await reauthenticateWithCredential(current, EmailAuthProvider.credential(current.email, currentPassword))
      await updatePassword(current, newPassword)
    },

    logout: async () => {
      await signOut(auth)
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
