import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const isSupabaseConfigured = Boolean(url && publishableKey)

if (!isSupabaseConfigured) {
  // Warn rather than throw: throwing here runs at module-import time, which
  // main.tsx pulls in unconditionally through AuthContext — so it crashed
  // every route, including the public landing page, before React ever got
  // to render. A missing key should degrade (auth calls fail with a clear
  // error when actually attempted) rather than blank the whole app.
  console.warn(
    'Missing Supabase config. Copy frontend/.env.local.example to frontend/.env.local and fill in VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY. Auth and API calls will not work until then.'
  )
}

// Syntactically valid placeholders so createClient (a synchronous, no-network
// call) never throws — every real auth/API call still fails, just later and
// without taking the whole app down with it.
//
// Both-or-neither, deliberately: a real VITE_SUPABASE_URL paired with a fake
// key points the client at the real project but with an invalid apikey. The
// OAuth redirect-out leg doesn't check it, so Google sign-in still reaches
// the real consent screen — then the post-redirect code exchange 401s
// silently against the real token endpoint, no session is ever set, and the
// user bounces back to /login looking like "nothing happened". Using the
// placeholder host whenever *either* value is missing fails the same way for
// every call instead of that one confusing partial-failure mode.
export const supabase = isSupabaseConfigured
  ? createClient(url, publishableKey)
  : createClient('https://placeholder.supabase.co', 'placeholder-key')
