'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Copy, Info, Scale, Sparkles } from 'lucide-react'
import { generateCounterOffer, type CounterOffer } from '@/lib/apiClient'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'
import { springSoft } from '@/lib/motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

const usd = (value: number) => `$${value.toLocaleString('en-US')}`

function NegotiationForm() {
  const reduce = usePrefersReducedMotion()
  // Prefilled from the /offers "Draft counter-offer" bridge. Read as the
  // initial state rather than in an effect: this is a plain URL read with no
  // external store behind it, so a lazy initializer gives the same value on
  // server and client and avoids a second render.
  const searchParams = useSearchParams()
  const [role, setRole] = useState(() => searchParams.get('role') ?? '')
  const [company, setCompany] = useState(() => searchParams.get('company') ?? '')
  const [currentOffer, setCurrentOffer] = useState(() => searchParams.get('current') ?? '')
  const [targetOffer, setTargetOffer] = useState('')
  const [result, setResult] = useState<CounterOffer | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const handleGenerate = async () => {
    if (!role.trim()) {
      setError('Enter the role the offer is for.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const data = await generateCounterOffer({
        role: role.trim(),
        company: company.trim(),
        current_offer: currentOffer.trim(),
        target_offer: targetOffer.trim(),
      })
      setResult(data)
      setDraft(data.email)
    } catch {
      setError('Could not generate the draft. Check that the API is running and try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(draft)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard is permission-gated and unavailable over plain http. The
      // textarea is selectable, so failing silently here is better than an
      // error for something the user can still do by hand.
    }
  }

  const benchmark = result?.benchmark
  const hasData = !!benchmark && benchmark.sample_size > 0 && benchmark.median !== null

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8">
        <span className="eyebrow mb-3 inline-flex items-center gap-1.5">
          <Scale strokeWidth={1.5} className="h-3.5 w-3.5 text-[var(--color-accent)]" />
          Offer Negotiation
        </span>
        <h1 className="mt-3 mb-2 font-display text-2xl font-medium text-[var(--color-ink)] md:text-3xl">
          Ask for the number, properly.
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-[var(--color-ink-dim)]">
          Pay bands from real postings we&apos;ve cached, and a counter-offer draft you finish in
          your own words.
        </p>
      </div>

      <div className="card mb-6 space-y-4 p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="neg-role" className="eyebrow mb-2 block">
              Role
            </label>
            <Input
              id="neg-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Backend Engineer"
            />
          </div>
          <div>
            <label htmlFor="neg-company" className="eyebrow mb-2 block">
              Company <span className="text-[var(--color-ink-faint)]">(optional)</span>
            </label>
            <Input
              id="neg-company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="e.g. Acme"
            />
          </div>
          <div>
            <label htmlFor="neg-current" className="eyebrow mb-2 block">
              Their offer <span className="text-[var(--color-ink-faint)]">(optional)</span>
            </label>
            <Input
              id="neg-current"
              value={currentOffer}
              onChange={(e) => setCurrentOffer(e.target.value)}
              placeholder="e.g. $145,000"
            />
          </div>
          <div>
            <label htmlFor="neg-target" className="eyebrow mb-2 block">
              Your target <span className="text-[var(--color-ink-faint)]">(optional)</span>
            </label>
            <Input
              id="neg-target"
              value={targetOffer}
              onChange={(e) => setTargetOffer(e.target.value)}
              placeholder="e.g. $165,000"
            />
          </div>
        </div>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden border-l-[3px] border-[var(--color-error)] py-1.5 pl-3 text-sm text-[var(--color-error)]"
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        <Button type="button" onClick={handleGenerate} disabled={loading} aria-busy={loading || undefined}>
          {loading ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-on-accent)]/30 border-t-[var(--color-on-accent)]" />
              Drafting…
            </>
          ) : (
            <>
              <Sparkles strokeWidth={1.5} className="h-4 w-4" />
              Draft my counter-offer
            </>
          )}
        </Button>
      </div>

      {result && (
        <motion.div
          initial={{ opacity: 0, y: reduce ? 0 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reduce ? { duration: 0 } : springSoft}
          className="space-y-5"
        >
          <div className="card p-5">
            <span className="eyebrow mb-3 block">Market band</span>
            {hasData ? (
              <>
                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                  {(
                    [
                      ['25th', benchmark.p25],
                      ['Median', benchmark.median],
                      ['75th', benchmark.p75],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label}>
                      <div className="eyebrow text-[10px]">{label}</div>
                      <div
                        className="font-mono text-lg tabular-nums"
                        style={{ color: label === 'Median' ? 'var(--color-ink)' : 'var(--color-ink-dim)' }}
                      >
                        {value !== null ? usd(value) : '—'}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-[var(--color-ink-dim)]">
                  From {benchmark.sample_size} cached posting{benchmark.sample_size !== 1 ? 's' : ''}{' '}
                  matching &ldquo;{benchmark.role}&rdquo;
                  {benchmark.low !== null && benchmark.high !== null && (
                    <> · full range {usd(benchmark.low)}–{usd(benchmark.high)}</>
                  )}
                  .
                  {benchmark.sample_size < 8 && ' Small sample — treat it as directional, not definitive.'}
                </p>
              </>
            ) : (
              /* Explicitly stated rather than rendered as an empty band: an
                 absent benchmark shown as "—" reads as $0 or as a loading
                 failure, and this is a number people repeat to employers. */
              <div className="flex items-start gap-2.5">
                <Info strokeWidth={1.5} className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" />
                <p className="text-xs leading-relaxed text-[var(--color-ink-dim)]">
                  No cached postings with pay data match &ldquo;{benchmark?.role}&rdquo;, so there&apos;s no
                  band to show — we&apos;d rather say that than invent one. Browse{' '}
                  <span className="text-[var(--color-ink)]">Job Market</span> for this role to pull
                  fresh listings, and cite a specific competing offer or levelling guide in the draft
                  below.
                </p>
              </div>
            )}
          </div>

          <div className="card p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="eyebrow">Counter-offer draft</span>
              <Button type="button" variant="ghost" size="sm" onClick={handleCopy}>
                {copied ? (
                  <>
                    <Check strokeWidth={1.5} className="text-[var(--color-signal-high)]" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy strokeWidth={1.5} />
                    Copy
                  </>
                )}
              </Button>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-[var(--color-ink-dim)]">
              Everything in [brackets] is yours to fill in. The draft deliberately makes no claim
              about your background — a hiring manager can check those, so they need to be true.
            </p>
            <Textarea
              aria-label="Counter-offer draft"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={16}
              className="font-mono text-xs leading-relaxed"
            />
          </div>
        </motion.div>
      )}
    </div>
  )
}

// useSearchParams opts the route into client-side rendering, and Next requires
// a Suspense boundary around it or the whole page is excluded from static
// generation with a build-time error.
export default function NegotiationPage() {
  return (
    <Suspense fallback={null}>
      <NegotiationForm />
    </Suspense>
  )
}
