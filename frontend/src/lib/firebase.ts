import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'

const apiKey = import.meta.env.VITE_FIREBASE_API_KEY
const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN
const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID
const appId = import.meta.env.VITE_FIREBASE_APP_ID

export const isFirebaseConfigured = Boolean(apiKey && authDomain && projectId)

if (!isFirebaseConfigured) {
  // Warn rather than throw: this module is imported at startup through
  // AuthContext, so throwing here would blank every route, including the public
  // landing page, before React rendered anything. A missing key should degrade
  // (auth calls fail with a clear error when actually attempted).
  console.warn(
    'Missing Firebase config. Copy frontend/.env.local.example to frontend/.env.local and fill in the VITE_FIREBASE_* values. Sign-in and API calls will not work until then.'
  )
}

// Both-or-neither, deliberately: a real project id paired with a made-up key
// fails confusingly (the popup opens, then the exchange is rejected and it
// looks as though nothing happened). Placeholders for every field make every
// call fail the same, obvious way. initializeApp and getAuth make no network
// call, so they never throw here.
export const firebaseApp = initializeApp(
  isFirebaseConfigured
    ? { apiKey, authDomain, projectId, appId }
    : { apiKey: 'placeholder-key', authDomain: 'placeholder.invalid', projectId: 'placeholder' }
)

export const auth = getAuth(firebaseApp)

/**
 * A token for the API, or null when nobody is signed in.
 *
 * Waits for the SDK to finish restoring a saved session first: on a page load
 * `auth.currentUser` is null until that settles, and a request fired in that
 * window would go out unauthenticated and be rejected as if the person had
 * been signed out. The SDK returns the cached token unless it expires within
 * five minutes, in which case it refreshes it; `forceRefresh` mints a new one
 * regardless, which is what picks up a changed claim such as email_verified.
 */
export async function getIdToken(forceRefresh = false): Promise<string | null> {
  await auth.authStateReady()
  const user = auth.currentUser
  return user ? user.getIdToken(forceRefresh) : null
}
