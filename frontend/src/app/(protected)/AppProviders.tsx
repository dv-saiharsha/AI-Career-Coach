'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/lib/AuthContext'
import { ToastProvider } from '@/components/ui/toast'
import { NetworkActivityBar } from '@/components/NetworkActivityBar'

/**
 * Everything the signed-in application needs and the marketing site does not.
 *
 * This sat at the root until now. Moving it here is what keeps React Query,
 * the Supabase session listener behind AuthProvider, and the toast host out
 * of the landing, pricing, features and how-it-works bundles — none of which
 * issue a query, have a user, or raise a toast.
 *
 * It is a client boundary inside a server layout, so the layout's own
 * signature-verified auth check still runs on the server before any of this
 * is sent.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          {/* Mounted here rather than in the layout so it sits inside the
              client boundary that owns the transport it listens to. */}
          <NetworkActivityBar />
          {children}
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
