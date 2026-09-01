import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Reveal, RevealGroup } from '@/lib/reveal'

/**
 * The closing call to action.
 *
 * One button, and it carries the same label as the one in the nav and the
 * hero. Three different phrasings of the same intent on one page makes a
 * visitor wonder whether they lead to three different places.
 */
export function Close() {
  return (
    <section aria-labelledby="close-heading" className="px-4 section-y">
      <div className="shell">
        <RevealGroup className="mx-auto flex max-w-3xl flex-col items-center rounded-3xl bg-canvas-raise px-6 py-14 text-center neu-raised-lg lg:px-16 lg:py-20">
          <Reveal as="h2" id="close-heading" className="text-section text-balance text-ink">
            Start with one job advert
          </Reveal>
          <Reveal
            as="p"
            className="mt-5 max-w-[46ch] text-[16px] font-light leading-relaxed text-ink-dim"
          >
            Ten minutes from now you will know what the software sees in your CV, and what to
            change first.
          </Reveal>
          <Reveal className="mt-9">
            <Button asChild size="lg">
              <Link href="/register">
                Start free
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </Reveal>
          <Reveal as="p" className="mt-6 text-[13px] text-ink-faint">
            No card, ever
          </Reveal>
        </RevealGroup>
      </div>
    </section>
  )
}
