import type { Metadata } from 'next'
import { SiteNav } from '@/components/landing/SiteNav'
import { Hero } from '@/components/landing/Hero'
import { Sources } from '@/components/landing/Sources'
import { Features } from '@/components/landing/Features'
import { Numbers } from '@/components/landing/Numbers'
import { Sandbox } from '@/components/landing/Sandbox'
import { WhoFor } from '@/components/landing/WhoFor'
import { Pricing } from '@/components/landing/Pricing'
import { Questions } from '@/components/landing/Questions'
import { Close } from '@/components/landing/Close'
import { SiteFooter } from '@/components/landing/SiteFooter'

export const metadata: Metadata = {
  title: 'Free help with your job search',
}

/**
 * The landing page.
 *
 * Everything here is a server component except the nav (which owns a mobile
 * drawer) and the sandbox (which is the interactive demo). The largest thing
 * above the fold, the dashboard mock, ships as plain markup and needs no
 * JavaScript to paint.
 *
 * The page no longer pins itself to a fixed light palette the way the old
 * `marketing-surface` class did. It follows the visitor's theme like every
 * other route, which is why the theme toggle in the nav now does something
 * here rather than being hidden.
 */
export default function Home() {
  return (
    <>
      <SiteNav />
      <Hero />
      <Sources />
      <Features />
      <Numbers />
      <Sandbox />
      <WhoFor />
      <Pricing />
      <Questions />
      <Close />
      <SiteFooter />
    </>
  )
}
