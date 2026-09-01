import { Reveal, RevealGroup } from '@/lib/reveal'

const SOURCES = [
  {
    name: 'Indeed',
    body: 'Every job you apply to through Indeed appears here, with the posting kept alongside it.',
  },
  {
    name: 'LinkedIn',
    body: 'The same for LinkedIn. Applications from both are matched up, so one job never shows twice.',
  },
  {
    name: 'Anything else',
    body: 'Applied somewhere directly, or by email? Add it by hand in a few seconds and it joins the rest.',
  },
] as const

/**
 * Where applications come from.
 *
 * This is the slot a landing page usually fills with a "trusted by" wall of
 * well-known logos. There is no honest version of that here: this is a
 * charity programme, not a company with enterprise customers, and a row of
 * borrowed brand marks would be a claim it cannot support. What it can
 * support is what it actually connects to, so that is what the band says.
 */
export function Sources() {
  return (
    <section aria-labelledby="sources-heading" className="px-4 py-14 lg:py-16">
      <div className="shell">
        <h2 id="sources-heading" className="sr-only">
          Where your applications come from
        </h2>

        <RevealGroup className="grid gap-6 sm:grid-cols-3 sm:gap-10">
          {SOURCES.map((source) => (
            <Reveal key={source.name} className="flex flex-col gap-2">
              <p className="text-eyebrow text-accent-text">{source.name}</p>
              <p className="max-w-[38ch] text-[14px] font-light leading-relaxed text-ink-dim">
                {source.body}
              </p>
            </Reveal>
          ))}
        </RevealGroup>
      </div>
    </section>
  )
}
