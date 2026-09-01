import { Reveal, RevealGroup } from '@/lib/reveal'

/* Not testimonials. This programme has no bank of quotes it can attribute
   to real named people, and inventing three would be exactly the kind of
   thing its users are entitled to assume it does not do. These are the
   situations the service was built around, stated as situations. */
const SITUATIONS = [
  {
    who: 'Changing career',
    body: 'Your experience is real but it is described in the wrong words for the jobs you now want. The CV check tells you which words those are.',
  },
  {
    who: 'Coming back after time away',
    body: 'Hiring has changed since you last did it, and most of the change is invisible. Start with what the filters look for, then practise the conversation.',
  },
  {
    who: 'Made redundant',
    body: 'You are applying at volume and losing track of what went where. Both sources sync in on their own, so the list is right without you maintaining it.',
  },
] as const

/**
 * Rows rather than cards: three cards here would be the third grid on the
 * page. A numbered vertical list also suits the content, which is read one
 * at a time until someone recognises themselves.
 */
export function WhoFor() {
  return (
    <section aria-labelledby="whofor-heading" className="px-4 section-y">
      <div className="shell">
        <Reveal className="mb-12 max-w-2xl lg:mb-16">
          <h2 id="whofor-heading" className="text-section text-ink">
            Built for a few particular situations
          </h2>
        </Reveal>

        <RevealGroup as="ol" className="mx-auto flex max-w-4xl flex-col">
          {SITUATIONS.map((situation, i) => (
            <Reveal
              as="li"
              key={situation.who}
              className="grid gap-x-8 gap-y-3 py-8 sm:grid-cols-[auto_1fr] lg:py-10"
            >
              <span
                aria-hidden="true"
                className="flex size-12 shrink-0 items-center justify-center rounded-full bg-canvas font-mono text-[14px] font-semibold text-accent-text neu-inset-sm"
              >
                {i + 1}
              </span>
              <div>
                <h3 className="text-card-title text-ink">{situation.who}</h3>
                <p className="mt-2 max-w-[58ch] text-[15px] font-light leading-relaxed text-ink-dim">
                  {situation.body}
                </p>
              </div>
            </Reveal>
          ))}
        </RevealGroup>
      </div>
    </section>
  )
}
