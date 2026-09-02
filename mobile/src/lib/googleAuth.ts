import { Platform } from 'react-native'
import * as AuthSession from 'expo-auth-session'
import * as WebBrowser from 'expo-web-browser'

import { supabase } from './supabase'

/**
 * Google sign-in, through Supabase, without a second Google client.
 *
 * The web app already signs in with Google, and the OAuth client for it lives
 * in the Supabase dashboard rather than in this repo — backend/.env keeps the
 * ID and secret only as a recovery copy, and says so. This flow reuses that
 * exact configuration: Supabase performs the token exchange, so the app never
 * holds a client secret, and a native Google SDK with its own iOS and Android
 * client IDs is never introduced.
 *
 * HOW IT RUNS
 *
 * `signInWithOAuth({ skipBrowserRedirect: true })` returns the consent URL
 * instead of navigating to it. That URL opens in an in-app browser tab, the
 * user approves, and Google redirects back to `applycenter://auth/callback` —
 * the scheme declared in app.config.ts. Supabase puts the tokens in that
 * URL's fragment, which `setSession` then stores through the keychain adapter
 * in supabase.ts, exactly as a password sign-in would.
 *
 * `openAuthSessionAsync` rather than `openBrowserAsync`: on iOS the former
 * uses ASWebAuthenticationSession, which shares cookies with Safari. That is
 * what makes an already-signed-in Google account one tap instead of a full
 * password-and-2FA round trip, and it is also what dismisses the sheet
 * automatically on redirect.
 */

/* Required once per app so the browser result is delivered back if the OS
   suspended the app while the sheet was open. Safe to call at import: it only
   registers a listener. */
WebBrowser.maybeCompleteAuthSession()

export type GoogleOutcome = 'signed-in' | 'cancelled'

/** Where Google returns to. Uses the Expo proxy in Expo Go, the app scheme otherwise. */
export function redirectUri(): string {
  return AuthSession.makeRedirectUri({
    scheme: 'applycenter',
    path: 'auth/callback',
  })
}

/** Tokens arrive in the URL fragment, not the query string. */
function parseFragment(url: string): Record<string, string> {
  const hash = url.includes('#') ? url.slice(url.indexOf('#') + 1) : ''
  const params: Record<string, string> = {}
  for (const pair of hash.split('&')) {
    if (!pair) continue
    const [key, value] = pair.split('=')
    if (key) params[decodeURIComponent(key)] = decodeURIComponent(value ?? '')
  }
  return params
}

export async function signInWithGoogle(): Promise<GoogleOutcome> {
  const redirectTo = redirectUri()

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      // Return the URL rather than navigating. On native there is nothing to
      // navigate; on web this keeps both platforms on one code path.
      skipBrowserRedirect: true,
    },
  })
  if (error) throw new Error(error.message)
  if (!data?.url) throw new Error('Google sign-in is not configured for this project.')

  if (Platform.OS === 'web') {
    // A browser can just go there, and Supabase picks the session back up on
    // return because detectSessionInUrl is true on web (see supabase.ts).
    globalThis.location.assign(data.url)
    return 'signed-in'
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo)

  // 'cancel' is the user dismissing the sheet, 'dismiss' the OS closing it.
  // Neither is an error worth showing — they chose not to continue.
  if (result.type !== 'success') return 'cancelled'

  const params = parseFragment(result.url)

  if (params.error_description || params.error) {
    throw new Error(params.error_description || params.error)
  }

  const accessToken = params.access_token
  const refreshToken = params.refresh_token
  if (!accessToken || !refreshToken) {
    /* Reached when Supabase is set to the PKCE flow, which returns a `code`
       to exchange instead of tokens in the fragment. Handled rather than
       left to fail as "missing token", because which flow a project uses is
       a dashboard setting nobody remembers choosing. */
    if (params.code) {
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(params.code)
      if (exchangeError) throw new Error(exchangeError.message)
      return 'signed-in'
    }
    throw new Error('Google did not return a session. Try again.')
  }

  const { error: sessionError } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  })
  if (sessionError) throw new Error(sessionError.message)

  return 'signed-in'
}
