import type { Metadata, Viewport } from 'next'
import { Sora, Geist_Mono } from 'next/font/google'
import './globals.css'
import Providers from '@/components/Providers'

/* One geometric sans for body, display and wordmark alike. Hierarchy comes
   from size, weight and tracking rather than from a contrasting face.

   Sora replaces both Geist and Space Grotesk: two families ship instead of
   three, which is a net asset saving against the Part 6 budget rather than
   an addition. Only the four weights the type scale actually uses are
   requested — 300 body, 400/500 UI, 600 display and wordmark. */
const sora = Sora({
  weight: ['300', '400', '500', '600'],
  subsets: ['latin'],
  variable: '--font-sora',
  display: 'swap',
  /* Sora's metrics sit close enough to Arial that a swap does not reflow
     the line box, which is what keeps CLS at zero while the face loads. */
  adjustFontFallback: true,
})

/* Mono carries labels, eyebrows and every metric. Tabular figures are the
   reason it exists here: a metric that changes width as it counts is a
   layout shift on every tick. */
const geistMono = Geist_Mono({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'ApplyCenter',
    template: '%s · ApplyCenter',
  },
  description:
    'Free help with your job search. Understand how employers read your CV, ' +
    'keep track of every application, and practise for interviews. ' +
    'Free for every jobseeker we serve.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`h-full ${sora.variable} ${geistMono.variable}`}
    >
      <body className="min-h-full font-sans antialiased">
        <a
          href="#main"
          className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-100 focus-visible:rounded-full focus-visible:elev-accent focus-visible:px-5 focus-visible:py-2.5 focus-visible:text-sm focus-visible:font-medium"
        >
          Skip to content
        </a>
        <Providers>
          <div className="flex min-h-screen flex-col">
            <main id="main" className="flex-1">
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  )
}
