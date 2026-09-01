import { FileSearch, ListChecks, MessagesSquare, ShieldCheck } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Reveal, RevealGroup } from '@/lib/reveal'

interface Feature {
  icon: LucideIcon
  title: string
  body: string
  /** Spans both rows of the left column. Exactly one feature does. */
  wide?: boolean
  /** The one accent surface in the grid. Exactly one feature is. */
  accent?: boolean
}

const FEATURES: readonly Feature[] = [
  {
    icon: FileSearch,
    title: 'See what the software sees',
    body: 'Most applications are read by a filter before a person ever opens them. We show you what that filter finds in your CV, what it misses, and which words to change. Nothing is guessed: the same CV against the same job always gives the same answer, and every point taken off names its reason.',
    wide: true,
  },
  {
    icon: ListChecks,
    title: 'Every application in one place',
    body: 'Applied through Indeed on Monday and LinkedIn on Thursday? Both land here, matched up so a job never appears twice, with what stage each one has reached.',
  },
  {
    icon: MessagesSquare,
    title: 'Practise before the interview',
    body: 'Questions written for the role and the level you applied for, with written feedback on each answer, and a record so you can see yourself getting better.',
  },
  {
    icon: ShieldCheck,
    title: 'Yours to take back',
    body: 'Your CV is private to your account. Export everything or delete everything from your settings, in two clicks, without emailing anyone to ask.',
    accent: true,
  },
]

/**
 * Four cards on a 1.25/1 rhythm rather than four equal ones: the first
 * feature is the reason people arrive, and a grid that gives it the same
 * room as the others says it is the same size of thing.
 *
 * Exactly one card is the accent surface, and it is the one about getting
 * your data back — for this audience that is a feature, not a footnote.
 */
export function Features() {
  return (
    <section aria-labelledby="features-heading" className="px-4 section-y">
      <div className="shell">
        <RevealGroup className="mb-12 max-w-2xl lg:mb-16">
          <Reveal as="p" className="text-eyebrow text-ink-faint">
            What you get
          </Reveal>
          <Reveal as="h2" id="features-heading" className="mt-4 text-section text-ink">
            Four things, done properly
          </Reveal>
        </RevealGroup>

        <RevealGroup className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
          {FEATURES.map((feature) => {
            const Icon = feature.icon
            const accent = feature.accent === true
            return (
              <Reveal
                key={feature.title}
                className={
                  'rounded-2xl p-[22px] lg:p-[30px] ' +
                  (accent ? 'neu-accent' : 'bg-canvas-raise neu-raised') +
                  (feature.wide ? ' lg:row-span-2 lg:flex lg:flex-col lg:justify-between' : '')
                }
              >
                <span
                  className={
                    'mb-6 flex size-11 items-center justify-center rounded-md ' +
                    (accent ? 'bg-[rgb(255_255_255/0.16)]' : 'bg-canvas neu-inset-sm')
                  }
                >
                  <Icon
                    className={'size-5 ' + (accent ? 'text-on-accent' : 'text-accent-text')}
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                </span>
                <div>
                  <h3 className={'text-card-title ' + (accent ? 'text-on-accent' : 'text-ink')}>
                    {feature.title}
                  </h3>
                  <p
                    className={
                      'mt-3 max-w-[46ch] text-[14.5px] font-light leading-relaxed ' +
                      (accent ? 'text-on-accent/90' : 'text-ink-dim')
                    }
                  >
                    {feature.body}
                  </p>
                </div>
              </Reveal>
            )
          })}
        </RevealGroup>
      </div>
    </section>
  )
}
