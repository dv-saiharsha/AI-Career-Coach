import Link from 'next/link'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Reveal, RevealGroup } from '@/lib/reveal'

const JOBSEEKER = [
  'The full CV check, as often as you like',
  'Both application sources, synced',
  'Interview practice with written feedback',
  'Export or delete everything, any time',
] as const

const PARTNER = [
  'Everything in the jobseeker tier, for everyone you serve',
  'Shared view of how your cohort is progressing',
  'Your branding on what the people you support see',
  'Someone to email when it breaks',
] as const

/**
 * Two tiers, and the free one is not a trial.
 *
 * The individual tier is permanently free because the people it is for
 * cannot pay, which is the entire reason this programme exists. It is
 * written that way rather than as "free forever" marketing: no countdown, no
 * card, no locked feature, no upgrade nudge anywhere in the product.
 *
 * Money comes from organisations that have budgets — bootcamps, career
 * centres, universities, other charities. The accent surface goes on the
 * partner tier because that is the one being sold; putting it on the free
 * tier would be dressing a gift up as a purchase.
 */
export function Pricing() {
  return (
    <section aria-labelledby="pricing-heading" className="px-4 section-y">
      <div className="shell">
        <RevealGroup className="mb-12 max-w-2xl lg:mb-16">
          <Reveal as="p" className="text-eyebrow text-ink-faint">
            What it costs
          </Reveal>
          <Reveal as="h2" id="pricing-heading" className="mt-4 text-section text-ink">
            Free for every jobseeker we serve
          </Reveal>
          <Reveal
            as="p"
            className="mt-5 max-w-[56ch] text-[16px] font-light leading-relaxed text-ink-dim"
          >
            Not a trial and not a limited version. Organisations that support jobseekers pay for
            the programme so that the people using it do not have to.
          </Reveal>
        </RevealGroup>

        <RevealGroup className="grid gap-5 lg:grid-cols-2">
          {/* ── Free ─────────────────────────────────────────────── */}
          <Reveal className="flex flex-col rounded-2xl bg-canvas-raise p-[22px] neu-raised lg:p-[30px]">
            <p className="text-eyebrow text-ink-faint">If you are looking for work</p>
            <p className="mt-5 flex items-baseline gap-2">
              <span className="text-metric-lg text-ink">Free</span>
              <span className="text-[14px] font-light text-ink-dim">and it stays free</span>
            </p>
            <ul className="mt-8 flex flex-1 flex-col gap-4">
              {JOBSEEKER.map((line) => (
                <li key={line} className="flex gap-3">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-canvas neu-inset-sm">
                    <Check className="size-3 text-accent-text" strokeWidth={2.5} aria-hidden="true" />
                  </span>
                  <span className="text-[14.5px] font-light leading-relaxed text-ink-dim">{line}</span>
                </li>
              ))}
            </ul>
            <Button asChild variant="secondary" size="lg" className="mt-9 w-full">
              <Link href="/register">Start free</Link>
            </Button>
          </Reveal>

          {/* ── Partner ──────────────────────────────────────────── */}
          <Reveal className="flex flex-col rounded-2xl p-[22px] neu-accent lg:p-[30px]">
            <p className="text-eyebrow text-on-accent/80">If you support jobseekers</p>
            <p className="mt-5 flex items-baseline gap-2">
              <span className="text-metric-lg text-on-accent">Per cohort</span>
            </p>
            <p className="mt-2 text-[14px] font-light text-on-accent/80">
              Priced on how many people you serve. Smaller organisations pay less, and some pay
              nothing.
            </p>
            <ul className="mt-8 flex flex-1 flex-col gap-4">
              {PARTNER.map((line) => (
                <li key={line} className="flex gap-3">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[rgb(255_255_255/0.18)]">
                    <Check className="size-3 text-on-accent" strokeWidth={2.5} aria-hidden="true" />
                  </span>
                  <span className="text-[14.5px] font-light leading-relaxed text-on-accent/90">
                    {line}
                  </span>
                </li>
              ))}
            </ul>
            <Button
              asChild
              size="lg"
              className="mt-9 w-full bg-canvas-raise bg-none text-ink shadow-(--neu-raised-sm) hover:bg-canvas-raise"
            >
              <Link href="/pricing">Talk to us</Link>
            </Button>
          </Reveal>
        </RevealGroup>
      </div>
    </section>
  )
}
