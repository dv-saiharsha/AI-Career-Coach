'use client'

import type { ReactNode } from 'react'
import { ThemeProvider } from 'next-themes'
import { CommandPaletteMount } from '@/components/command-palette'

/**
 * The root client boundary, and deliberately almost empty.
 *
 * It used to mount React Query, the auth context, the command palette and
 * the toast host here, which put all four — and everything they import — in
 * the initial graph of every route. A marketing page that queries nothing
 * and has no signed-in user was paying for a QueryClient and a Supabase
 * session listener before it painted.
 *
 * What is left is what genuinely is global: the theme, because the toggle
 * sits in the marketing nav as well as the app nav, and the palette's ⌘K
 * listener, which is a keydown handler and nothing more until it fires.
 * Everything else lives in app/(protected)/AppProviders.tsx.
 */
export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="data-theme"
      /* Dark is the primary, designed-first theme; light is a real second
         theme, not a fallback. enableSystem stays off because the choice is
         a product decision the user makes with the toggle, and a silent OS
         swap on first paint is a worse first impression than one consistent
         one. */
      defaultTheme="dark"
      enableSystem={false}
      storageKey="aicc_theme"
      disableTransitionOnChange
    >
      {children}
      <CommandPaletteMount />
    </ThemeProvider>
  )
}
