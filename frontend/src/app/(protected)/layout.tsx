import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { createClient } from '../../lib/supabase/server'
import { DashboardNav } from '../../components/DashboardNav'
import { ProtectedTransition } from './ProtectedTransition'
import { AppProviders } from './AppProviders'
import { OnboardingGate } from './OnboardingGate'

/**
 * proxy.ts already verified this request's JWT signature against Supabase's
 * published keys and redirected it to /login if that failed, so this layout
 * reads the subject it forwarded rather than verifying the same token again.
 *
 * The second verification was not free. Both calls were sequential and both
 * ran before any HTML could be produced, on every protected navigation —
 * they were the first two stages of the post-login wait, and the second one
 * answered a question the first had already answered.
 *
 * The gate itself is unchanged. Nothing reaches this layout without having
 * passed the middleware, and the header is set on the rewritten request
 * inside that hop, so it cannot be supplied by a client. The `createClient`
 * fallback below covers the one case where it legitimately can be absent —
 * a route rendered outside the matcher — and fails closed.
 */
export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const verified = (await headers()).get('x-verified-user')

  if (!verified) {
    // Not on the middleware's path: verify here instead of assuming.
    const supabase = await createClient()
    const { data, error } = await supabase.auth.getClaims()
    if (error || !data?.claims) redirect('/login')
  }

  return (
    <AppProviders>
      <OnboardingGate />
      <DashboardNav>
        <ProtectedTransition>{children}</ProtectedTransition>
      </DashboardNav>
    </AppProviders>
  )
}
