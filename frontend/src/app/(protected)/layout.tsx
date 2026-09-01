import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { createClient } from '../../lib/supabase/server'
import { DashboardNav } from '../../components/DashboardNav'
import { ProtectedTransition } from './ProtectedTransition'
import { AppProviders } from './AppProviders'

// middleware.ts already redirects unauthenticated requests before any React
// rendering happens (the primary gate, with no flicker). This is a second,
// defense-in-depth check — getClaims() verifies the JWT signature directly
// rather than trusting a cookie's mere presence.
export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()

  if (error || !data?.claims) {
    redirect('/login')
  }

  return (
    <AppProviders>
      <DashboardNav>
        <ProtectedTransition>{children}</ProtectedTransition>
      </DashboardNav>
    </AppProviders>
  )
}
