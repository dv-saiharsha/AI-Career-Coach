import { Reveal, RevealGroup } from '@/lib/reveal'

/* Every figure here is something the system computes, traceable to code:
   the rubric weights in resume_analyzer/rubric.py, the scoring dimensions in
   evaluation.py, the pipeline stages in models/application.py, and the two
   sources in the ingestion layer.

   Deliberately no callback rates, no salary totals, no "users helped". The
   programme does not measure those, so publishing them would be invention,
   and this is the kind of organisation that has to be able to stand behind
   every number on its own front page. */
const NUMBERS = [
  { value: '7', unit: 'checks', label: 'On every CV', note: 'each one weighted and named' },
  { value: '4', unit: 'parts', label: 'Behind each score', note: 'every deduction explained' },
  { value: '12', unit: 'stages', label: 'From saved to offer', note: 'the whole pipeline' },
  { value: '2', unit: 'sources', label: 'Synced for you', note: 'Indeed and LinkedIn' },
] as const

/**
 * The metrics band: one long inset well cut into the canvas, with the
 * numbers sitting in it. Grouping is the well and the spacing, not four
 * cards — four cards here would repeat the feature grid directly above.
 */
export function Numbers() {
  return (
    <section aria-labelledby="numbers-heading" className="px-4 pb-4 lg:pb-8">
      <div className="shell">
        <h2 id="numbers-heading" className="sr-only">
          What the system measures
        </h2>

        <RevealGroup className="grid grid-cols-2 gap-8 rounded-3xl bg-canvas px-6 py-10 field-ring sm:gap-10 lg:grid-cols-4 lg:px-12 lg:py-12">
          {NUMBERS.map((item) => (
            <Reveal key={item.label} className="flex flex-col">
              <p className="flex items-baseline gap-2">
                <span className="text-metric-lg text-ink">{item.value}</span>
                <span className="text-micro text-ink-faint">{item.unit}</span>
              </p>
              <p className="mt-3 text-[14px] font-medium text-ink">{item.label}</p>
              <p className="mt-1 text-[13px] font-light leading-snug text-ink-dim">{item.note}</p>
            </Reveal>
          ))}
        </RevealGroup>
      </div>
    </section>
  )
}
