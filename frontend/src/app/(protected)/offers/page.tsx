'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MapPin, Plus, Trash2 } from 'lucide-react'
import {
  createOffer,
  deleteOffer,
  getOffers,
  type CreateOfferPayload,
  type JobOffer,
} from '@/lib/apiClient'
import { PageHeader } from '@/components/PageHeader'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

const OFFERS_KEY = ['offers'] as const

const money = (value: number) =>
  value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

const COMPONENTS = [
  { key: 'base_salary', label: 'Base salary' },
  { key: 'annual_bonus', label: 'Annual bonus' },
  { key: 'equity_value_annual', label: 'Equity (annual)' },
  { key: 'signing_bonus', label: 'Signing bonus', yearOneOnly: true },
] as const

/** Proportional bar showing what the recurring package is actually made of. */
function CompositionBar({ offer }: { offer: JobOffer }) {
  const parts = [
    { label: 'Base', value: offer.base_salary, color: 'var(--color-ink)' },
    { label: 'Bonus', value: offer.annual_bonus, color: 'var(--color-ink-dim)' },
    { label: 'Equity', value: offer.equity_value_annual, color: 'var(--color-ink-faint)' },
  ].filter((p) => p.value > 0)

  const total = parts.reduce((sum, p) => sum + p.value, 0)
  if (total === 0) return null

  return (
    <div>
      <div
        className="flex h-1.5 overflow-hidden rounded-full"
        role="img"
        aria-label={parts.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join(', ')}
      >
        {parts.map((part) => (
          <div
            key={part.label}
            style={{ width: `${(part.value / total) * 100}%`, background: part.color }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {parts.map((part) => (
          <span key={part.label} className="flex items-center gap-1 text-[10px] text-(--color-ink-faint)">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: part.color }} />
            {part.label} {Math.round((part.value / total) * 100)}%
          </span>
        ))}
      </div>
    </div>
  )
}

export default function OffersPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
    const [showAdd, setShowAdd] = useState(false)
  const [draft, setDraft] = useState({
    company: '',
    role_title: '',
    base_salary: '',
    annual_bonus: '',
    signing_bonus: '',
    equity_value_annual: '',
    location: '',
    estimated_tax_rate: '',
    col_index: '',
  })

  const { data, isLoading, isError } = useQuery({ queryKey: OFFERS_KEY, queryFn: getOffers })
  const offers = useMemo(() => data?.offers ?? [], [data])

  // Ranked on net_adjusted_comp, not year-one totals: the signing bonus is
  // paid once, so ranking on it would crown an offer worth less every year
  // after. net_adjusted_comp equals recurring_annual whenever no adjustment
  // was supplied, so this stays the comparable figure either way.
  const bestNet = useMemo(
    () => (offers.length ? Math.max(...offers.map((o) => o.net_adjusted_comp)) : 0),
    [offers],
  )

  const addMutation = useMutation({
    mutationFn: (payload: CreateOfferPayload) => createOffer(payload),
    onSuccess: () => {
      setDraft({
        company: '', role_title: '', base_salary: '',
        annual_bonus: '', signing_bonus: '', equity_value_annual: '', location: '',
        estimated_tax_rate: '', col_index: '',
      })
      setShowAdd(false)
      toast({ title: 'Offer added', description: 'It is now included in the comparison.' })
      queryClient.invalidateQueries({ queryKey: OFFERS_KEY })
    },
    onError: () =>
      toast({
        title: "Couldn't add that offer",
        description: 'Nothing was saved. Check your connection and try again.',
        variant: 'error',
      }),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteOffer,
    onMutate: async (offerId: number) => {
      await queryClient.cancelQueries({ queryKey: OFFERS_KEY })
      const previous = queryClient.getQueryData<typeof data>(OFFERS_KEY)
      queryClient.setQueryData(OFFERS_KEY, (current: typeof data) =>
        current
          ? { offers: current.offers.filter((o) => o.id !== offerId), count: current.count - 1 }
          : current,
      )
      return { previous }
    },
    // Restored on failure, so a rejected delete doesn't leave the card gone
    // from the screen but present in the database.
    onError: (_e, _v, context) => {
      if (context?.previous) queryClient.setQueryData(OFFERS_KEY, context.previous)
      toast({
        title: "Couldn't delete that offer",
        description: 'It has been restored to the comparison.',
        variant: 'error',
      })
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: OFFERS_KEY }),
  })

  const draftCurrent = () => {
    const value = Number(draft.base_salary)
    return Number.isFinite(value) && value > 0
  }


  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Offer Comparison"
        title="What each offer is really worth."
        description="Signing bonuses are counted in year one only, so a one-off payment can't disguise a weaker package."
        action={
          <Button type="button" size="sm" onClick={() => setShowAdd((v) => !v)}>
            <Plus strokeWidth={1.5} />
            Add offer
          </Button>
        }
      />

        {showAdd && (
          <form
           
           
           
           
            onSubmit={(event) => {
              event.preventDefault()
              if (!draft.company.trim() || !draft.role_title.trim() || !draftCurrent()) return
              addMutation.mutate({
                company: draft.company.trim(),
                role_title: draft.role_title.trim(),
                base_salary: Number(draft.base_salary),
                annual_bonus: Number(draft.annual_bonus) || 0,
                signing_bonus: Number(draft.signing_bonus) || 0,
                equity_value_annual: Number(draft.equity_value_annual) || 0,
                location: draft.location.trim() || null,
                // '' stays null rather than becoming 0: "not supplied" must
                // remain distinct from a deliberate 0% (no state income tax).
                estimated_tax_rate:
                  draft.estimated_tax_rate.trim() === ''
                    ? null
                    : Number(draft.estimated_tax_rate) / 100,
                col_index:
                  draft.col_index.trim() === '' ? null : Number(draft.col_index),
              })
            }}
            className="overflow-hidden panel-enter"
          >
            <div className="card mb-6 grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <Input
                value={draft.company}
                onChange={(e) => setDraft({ ...draft, company: e.target.value })}
                placeholder="Company" aria-label="Company"
              />
              <Input
                value={draft.role_title}
                onChange={(e) => setDraft({ ...draft, role_title: e.target.value })}
                placeholder="Role title" aria-label="Role title"
              />
              <Input
                type="number" min="0" inputMode="numeric"
                value={draft.base_salary}
                onChange={(e) => setDraft({ ...draft, base_salary: e.target.value })}
                placeholder="Base salary" aria-label="Base salary"
              />
              <Input
                type="number" min="0" inputMode="numeric"
                value={draft.annual_bonus}
                onChange={(e) => setDraft({ ...draft, annual_bonus: e.target.value })}
                placeholder="Annual bonus" aria-label="Annual bonus"
              />
              <Input
                type="number" min="0" inputMode="numeric"
                value={draft.signing_bonus}
                onChange={(e) => setDraft({ ...draft, signing_bonus: e.target.value })}
                placeholder="Signing bonus" aria-label="Signing bonus"
              />
              <Input
                type="number" min="0" inputMode="numeric"
                value={draft.equity_value_annual}
                onChange={(e) => setDraft({ ...draft, equity_value_annual: e.target.value })}
                placeholder="Equity per year" aria-label="Equity per year"
              />
              <Input
                value={draft.location}
                onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                placeholder="Location (optional)" aria-label="Location"
              />
              <Input
                type="number" min="0" max="100" step="0.1" inputMode="decimal"
                value={draft.estimated_tax_rate}
                onChange={(e) => setDraft({ ...draft, estimated_tax_rate: e.target.value })}
                placeholder="Est. tax %" aria-label="Estimated effective tax rate, percent"
              />
              <Input
                type="number" min="0.01" step="0.01" inputMode="decimal"
                value={draft.col_index}
                onChange={(e) => setDraft({ ...draft, col_index: e.target.value })}
                placeholder="COL index (1.15)" aria-label="Cost of living index"
              />
              <Button
                type="submit" size="sm"
                disabled={
                  !draft.company.trim() || !draft.role_title.trim() || !draftCurrent() ||
                  addMutation.isPending
                }
              >
                {addMutation.isPending ? 'Adding…' : 'Add offer'}
              </Button>
            </div>
          </form>
        )}

      {isError && (
        <div className="card p-6">
          <p className="text-sm text-(--color-ink-dim)">
            Could not load your offers. Check that the API is running and try again.
          </p>
        </div>
      )}

      {isLoading && (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[340px]" />
          ))}
        </div>
      )}

      {!isLoading && !isError && offers.length === 0 && (
        <div className="card px-8 py-16 text-center">
          <p className="mx-auto max-w-sm text-sm leading-relaxed text-(--color-ink-faint)">
            No offers yet. Add one to see its true annual value broken down, and compare it against
            anything else on the table.
          </p>
        </div>
      )}

      {offers.length > 0 && (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {offers.map((offer) => {
              const isBest = offers.length > 1 && offer.net_adjusted_comp === bestNet
              return (
                <article
                  key={offer.id}
                 
                 
                 
                 
                  className="card flex flex-col gap-4 p-5 panel-enter"
                  style={
                    isBest ? { borderColor: 'var(--color-signal-high)' } : undefined
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="eyebrow text-[10px]">{offer.company}</span>
                      <h2 className="mt-1 truncate text-base font-medium text-(--color-ink)">
                        {offer.role_title}
                      </h2>
                      {(offer.location || offer.is_remote) && (
                        <span className="mt-1 flex items-center gap-1 text-xs text-(--color-ink-faint)">
                          <MapPin strokeWidth={1.5} className="h-3 w-3 shrink-0" />
                          {offer.is_remote ? 'Remote' : offer.location}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(offer.id)}
                      aria-label={`Remove the ${offer.company} offer`}
                      className="shrink-0 text-(--color-ink-faint) transition-colors hover:text-(--color-signal-low)"
                    >
                      <Trash2 strokeWidth={1.5} className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Recurring leads, not first-year: it's the number that
                      holds true beyond year one. */}
                  <div
                    className="rounded-md p-4"
                    style={{ background: 'var(--color-canvas)', border: '1px solid var(--color-canvas-line)' }}
                  >
                    <span className="eyebrow text-[10px]">
                      {offer.is_adjusted ? 'Net adjusted annual' : 'Recurring annual'}
                    </span>
                    <p className="mt-1 font-display text-2xl tabular-nums text-(--color-ink)">
                      {money(offer.is_adjusted ? offer.net_adjusted_comp : offer.recurring_annual)}
                    </p>
                    {offer.is_adjusted && (
                      <p className="mt-0.5 text-xs text-(--color-ink-dim)">
                        from {money(offer.recurring_annual)} gross
                        {offer.estimated_tax_rate !== null &&
                          ` · ${(offer.estimated_tax_rate * 100).toFixed(offer.estimated_tax_rate * 100 % 1 === 0 ? 0 : 1)}% tax`}
                        {offer.col_index !== null && offer.col_index !== 1 &&
                          ` · ${offer.col_index}x COL`}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-(--color-ink-dim)">
                      {money(offer.total_first_year)} in year one
                      {offer.signing_bonus > 0 && ` (incl. ${money(offer.signing_bonus)} signing)`}
                    </p>
                    {!offer.is_adjusted && (
                      <p className="mt-1 text-[10px] text-(--color-ink-faint)">
                        No tax or cost-of-living adjustment applied.
                      </p>
                    )}
                    {isBest && (
                      <span className="mt-2 inline-block text-[10px] font-mono uppercase tracking-wide text-(--color-signal-high)">
                        Highest net
                      </span>
                    )}
                  </div>

                  <CompositionBar offer={offer} />

                  <dl className="flex flex-col gap-1.5">
                    {COMPONENTS.map((component) => (
                      <div key={component.key} className="flex items-center justify-between gap-3">
                        <dt className="text-xs text-(--color-ink-dim)">
                          {component.label}
                          {'yearOneOnly' in component && component.yearOneOnly && (
                            <span className="ml-1 text-[10px] text-(--color-ink-faint)">
                              yr 1
                            </span>
                          )}
                        </dt>
                        <dd className="font-mono text-xs tabular-nums text-(--color-ink-subtle)">
                          {money(offer[component.key])}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  {offer.notes && (
                    <p className="text-xs leading-relaxed text-(--color-ink-faint)">{offer.notes}</p>
                  )}
                </article>
              )
            })}
        </div>
      )}

      {offers.length > 0 && (
        <p className="mt-5 text-xs leading-relaxed text-(--color-ink-faint)">
          Figures are the ones you entered — no cost-of-living or tax adjustment is applied, since
          effective rates depend on filing status, deductions, and state and local rules this
          app doesn&apos;t know.
        </p>
      )}
    </div>
  )
}
