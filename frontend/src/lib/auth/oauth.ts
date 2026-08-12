import { createClient } from '@/lib/supabase/client'

export type OAuthProvider = 'google' | 'linkedin_oidc' | 'github' | 'apple'

export const OAUTH_PROVIDERS: OAuthProvider[] = ['google', 'linkedin_oidc', 'github', 'apple']

export const PROVIDER_LABELS: Record<OAuthProvider, string> = {
  google: 'Google',
  linkedin_oidc: 'LinkedIn',
  github: 'GitHub',
  apple: 'Apple',
}

/**
 * Starts a provider redirect flow.
 *
 * On success the browser navigates away, so this does not resolve in any
 * meaningful sense — treat anything after the await as the failure path and
 * keep the caller's loading state set until navigation happens.
 *
 * Account linking is deliberately left to Supabase: when the provider returns
 * a *verified* email that matches an existing user, Supabase attaches the new
 * identity to that user rather than creating a second account. That behaviour
 * is only safe while "Allow unverified email logins" is off in the dashboard —
 * otherwise anyone who can create an account at any enabled provider using a
 * victim's address inherits the victim's Zenith account. See docs/oauth-setup.md.
 */
export async function signInWithOAuth(
  provider: OAuthProvider,
  options?: { next?: string }
) {
  const supabase = createClient()

  // Relative, single-leading-slash only. The callback validates this again
  // server-side; this check just avoids sending an obviously bad value.
  const requested = options?.next ?? '/dashboard'
  const next = /^\/(?!\/)/.test(requested) ? requested : '/dashboard'

  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo },
  })

  if (error) throw error
  return data
}
