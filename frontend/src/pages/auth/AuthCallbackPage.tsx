import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { toast } from 'sonner'

/**
 * Where every social sign-in lands: browser goes provider -> Supabase's own
 * callback -> here (see docs/oauth-setup.md — this exact path is what's
 * allow-listed in Supabase's Redirect URLs, /dashboard is not).
 *
 * supabase-js has already exchanged the URL's auth code for a session by the
 * time this component mounts (detectSessionInUrl runs on client init), so
 * there's nothing to parse here — just wait for AuthContext's
 * onAuthStateChange to catch up, then move on.
 */
export function AuthCallbackPage() {
  const navigate = useNavigate()
  const { user, ready } = useAuth()

  useEffect(() => {
    if (!ready) return

    if (user) {
      navigate('/dashboard', { replace: true })
      return
    }

    // No session after the OAuth round-trip: the user cancelled at the
    // provider, or Supabase rejected it (unverified email, provider not
    // enabled, etc). Supabase appends the reason as a query/hash param.
    const params = new URLSearchParams(window.location.search || window.location.hash.replace(/^#/, ''))
    const description = params.get('error_description') || params.get('error')
    toast.error(description ? description.replace(/\+/g, ' ') : 'Sign-in was cancelled.')
    navigate('/login', { replace: true })
  }, [ready, user, navigate])

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Signing you in...</p>
      </div>
    </div>
  )
}
