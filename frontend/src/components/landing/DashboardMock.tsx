import { AreaChart } from '@/components/charts/AreaChart'
import { BarChart } from '@/components/charts/BarChart'
import { ScoreRing } from '@/components/ScoreRing'

/* Sample data. Nothing here is a claim about outcomes — it is one made-up
   person's pipeline, shown so the shape of the product is legible before you
   sign up. The panel says so, once, underneath. */
const CALLBACKS = [2, 1, 3, 2, 4, 3, 5, 4, 6, 5, 7, 6] as const
const MONTHS = ['Jan', 'Apr', 'Jul', 'Oct'] as const

const TILES: readonly { label: string; value: string; note: string; accent?: boolean }[] = [
  { label: 'Applications', value: '38', note: 'across two sources' },
  { label: 'Replies', value: '9', note: 'since January', accent: true },
  { label: 'Interviews', value: '4', note: 'two still live' },
]

const SOURCES = [
  { label: 'Indeed', value: 21 },
  { label: 'LinkedIn', value: 14 },
  { label: 'Added by hand', value: 3 },
] as const

/**
 * The hero's proof: a browser-chromed slice of the real dashboard.
 *
 * Entirely server-rendered — no client JavaScript reaches the page for this,
 * which matters because it is the largest thing above the fold and therefore
 * the LCP element. Everything that moves (the two floating cards) moves in
 * CSS.
 */
export function DashboardMock() {
  return (
    <div className="relative mx-auto w-full max-w-4xl">
      {/* ── Sources card, pinned to the left edge ─────────────────────── */}
      <div
        className="chip-float animate-float-slow -left-6 top-24 hidden w-52 p-5 lg:block"
        style={{ ['--float-rot' as string]: '-2.5deg' }}
        aria-hidden="true"
      >
        <p className="mb-3 text-micro text-ink-faint">Where they came from</p>
        <BarChart bars={SOURCES} summary="Applications by source." />
      </div>

      {/* ── Best-match card, pinned to the right edge ─────────────────── */}
      <div
        className="chip-float animate-float-delayed -right-8 bottom-16 hidden w-44 items-center p-5 lg:flex lg:flex-col"
        style={{ ['--float-rot' as string]: '2deg' }}
        aria-hidden="true"
      >
        <p className="mb-3 self-start text-micro text-ink-faint">Best match today</p>
        <ScoreRing value={88} size={104} strokeWidth={9} />
      </div>

      {/* ── The window ────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-3xl bg-canvas-raise neu-raised-lg">
        {/* Chrome. The dots are inset, like every other pressed thing. */}
        <div className="flex items-center gap-2 px-6 py-4">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-2.5 rounded-full bg-canvas neu-inset-sm" aria-hidden="true" />
          ))}
          <span className="ml-3 text-micro text-ink-faint">Your applications</span>
        </div>

        <div className="flex flex-col gap-5 px-5 pb-6 sm:px-6 sm:pb-7">
          {/* Stat tiles. Exactly one is the accent surface. */}
          <div className="grid grid-cols-3 gap-4">
            {TILES.map((tile) => (
              <div
                key={tile.label}
                className={
                  'rounded-xl p-4 sm:p-5 ' +
                  (tile.accent ? 'neu-accent' : 'bg-canvas-raise neu-raised')
                }
              >
                <p className={'text-micro ' + (tile.accent ? 'text-on-accent/80' : 'text-ink-faint')}>
                  {tile.label}
                </p>
                <p
                  className={
                    'mt-2 text-metric ' + (tile.accent ? 'text-on-accent' : 'text-ink')
                  }
                >
                  {tile.value}
                </p>
                <p
                  className={
                    'mt-1 text-[12px] leading-snug ' +
                    (tile.accent ? 'text-on-accent/80' : 'text-ink-dim')
                  }
                >
                  {tile.note}
                </p>
              </div>
            ))}
          </div>

          {/* The chart sits in a well. */}
          <div className="rounded-2xl bg-canvas p-5 neu-inset">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <p className="text-[13px] font-medium text-ink">Replies over the year</p>
              <p className="text-micro text-ink-faint">Sample data</p>
            </div>
            <AreaChart
              id="hero-replies"
              data={CALLBACKS}
              labels={MONTHS}
              summary="Replies rose from two in January to six in December, with a dip each time a run of applications went unanswered."
            />
          </div>
        </div>
      </div>
    </div>
  )
}
