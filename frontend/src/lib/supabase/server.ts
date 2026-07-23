import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/** Server Component / Route Handler client — reads/writes the session cookie.
 * Server Components can't set cookies (middleware refreshes them instead),
 * so the setAll write is wrapped in a try/catch per Supabase's own pattern. */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // Called from a Server Component with no way to write cookies —
            // fine as long as middleware.ts is also refreshing sessions.
          }
        },
      },
    },
  )
}
