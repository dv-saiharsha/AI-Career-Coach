import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Reveal, RevealGroup } from '@/lib/reveal'
import { DashboardMock } from '@/components/landing/DashboardMock'

/**
 * The hero.
 *
 * Four text elements and no more: eyebrow, headline, subhead, and the form
 * with its own trust line. No version badge, no logo strip, no scroll cue.
 *
 * The email field is a real GET to /register so it works with scripting off
 * — the address is carried through and the sign-up page pre-fills it. There
 * is nothing to submit to on this page and nothing is stored here.
 */
export function Hero() {
  return (
    <section className="relative px-4 pb-16 pt-16 lg:pb-24 lg:pt-24">
      {/* Ambient wash. Decorative, behind everything, drifts on scroll via
          CSS only. No text sits on it. */}
      <div
        aria-hidden="true"
        className="parallax-wash pointer-events-none absolute inset-x-0 -top-24 -z-10 h-[70vh] ambient-wash"
      />

      <div className="shell">
        <RevealGroup className="mx-auto max-w-3xl text-center">
          <Reveal
            as="span"
            className="inline-flex items-center rounded-full bg-canvas-raise px-4 py-2 text-eyebrow text-ink-dim neu-raised-sm"
          >
            A free service for jobseekers
          </Reveal>

          <Reveal as="h1" className="mt-7 text-hero text-balance text-ink">
            Applying for jobs is exhausting.{' '}
            <span className="text-gradient inline-block">This part does not have to be.</span>
          </Reveal>

          <Reveal
            as="p"
            className="mx-auto mt-6 max-w-[52ch] text-[17px] font-light leading-relaxed text-ink-dim"
          >
            See how employers&rsquo; software reads your CV, keep every application in one place,
            and practise for the interview.
          </Reveal>

          <Reveal className="mt-9">
            <form
              action="/register"
              method="get"
              className="mx-auto flex w-full max-w-lg flex-col gap-3 sm:flex-row"
            >
              <label htmlFor="hero-email" className="sr-only">
                Your email address
              </label>
              <input
                id="hero-email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                className="h-12 w-full flex-1 rounded-md bg-canvas px-5 text-sm text-ink neu-inset placeholder:text-ink-faint outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
              />
              <Button type="submit" size="lg" className="shrink-0">
                Start free
                <ArrowRight aria-hidden="true" />
              </Button>
            </form>

            {/* The form's own reassurance, not a fifth hero element. */}
            <ul className="mx-auto mt-5 flex max-w-lg flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-ink-faint">
              <li>No card, ever</li>
              <li>Your data stays yours</li>
              <li>Delete any time</li>
            </ul>
          </Reveal>
        </RevealGroup>

        <Reveal className="mt-16 lg:mt-20">
          <DashboardMock />
        </Reveal>

        <p className="mt-8 text-center text-[13px] text-ink-faint">
          Sample data. Your own numbers replace it the moment you connect a source.{' '}
          <Link
            href="/how-it-works"
            className="text-accent-text underline underline-offset-4 outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          >
            How it works
          </Link>
        </p>
      </div>
    </section>
  )
}
