import React, { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { toast } from 'sonner'
import {
  Banknote,
  BarChart3,
  Gift,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Scale,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { HttpError } from '@/lib/http'
import { cn } from '@/lib/utils'
import { offersService } from '@/services/offersService'
import type { Offer, OfferCreatePayload, OfferFormValues } from '@/types/offers'

type WeightKey = 'compensation' | 'growth' | 'team' | 'flexibility'

const DEFAULT_WEIGHTS: Record<WeightKey, number> = { compensation: 30, growth: 25, team: 25, flexibility: 20 }
const WEIGHT_LABELS: Record<WeightKey, string> = {
  compensation: 'Compensation',
  growth: 'Career growth',
  team: 'Team & culture',
  flexibility: 'Flexibility',
}

// Growth/Team/Flexibility have no backing field anywhere in JobOffer/OfferSchema
// (only compensation is real, structured data) — these are the user's own 1-10
// ratings, kept on this device only and clearly labeled as such wherever shown.
interface LocalRatings {
  growth?: number
  team?: number
  flexibility?: number
}

const RATINGS_STORAGE_KEY = 'hireloom-offer-ratings'

function loadAllRatings(): Record<string, LocalRatings> {
  try {
    const raw = localStorage.getItem(RATINGS_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function persistRatings(all: Record<string, LocalRatings>) {
  try {
    localStorage.setItem(RATINGS_STORAGE_KEY, JSON.stringify(all))
  } catch {
    // Best-effort only — these ratings are a local convenience, never the
    // system of record, so a failed write (private browsing, full storage)
    // just means the rating resets next visit instead of breaking anything.
  }
}

const EMPTY_FORM: OfferFormValues = {
  company: '',
  role_title: '',
  base_salary: '',
  annual_bonus: '',
  signing_bonus: '',
  equity_value_annual: '',
  location: '',
  is_remote: false,
  notes: '',
  estimated_tax_rate_percent: '',
  col_index: '',
}

interface RatingsFormValues {
  growth: string
  team: string
  flexibility: string
}

const EMPTY_RATINGS: RatingsFormValues = { growth: '', team: '', flexibility: '' }

const moneyK = (value: number) => `$${Math.round(value / 1000)}k`

const formatPercent = (rate: number) => {
  const rounded = Math.round(rate * 1000) / 10
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`
}

const formatMultiplier = (value: number) => {
  const rounded = Math.round(value * 100) / 100
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(2)}×`
}

/** Blank -> 0 (a real, deliberate value for bonus/equity fields). */
function parseOptionalAmount(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return 0
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

/** Blank -> null ("not supplied"). Distinct from parseOptionalAmount's 0 default. */
function parseNullableNumber(raw: string): number | null | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseRating(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return undefined
  return Math.min(10, Math.max(1, Math.round(parsed)))
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof HttpError ? err.message : fallback
}

function initials(name: string): string {
  return (name || '?').trim().charAt(0).toUpperCase()
}

interface ComparisonRow {
  label: string
  render: (offer: Offer) => React.ReactNode
  emphasize?: boolean
}

function buildComparisonRows(hasAnyTaxOrCol: boolean): ComparisonRow[] {
  const rows: ComparisonRow[] = [
    { label: 'Base salary', render: (o) => moneyK(o.base_salary) },
    { label: 'Annual bonus', render: (o) => moneyK(o.annual_bonus) },
    { label: 'Signing bonus (year 1 only)', render: (o) => moneyK(o.signing_bonus) },
    { label: 'Annualized equity', render: (o) => moneyK(o.equity_value_annual) },
    {
      label: 'Location',
      render: (o) => (
        <span className="inline-flex items-center gap-1">
          <MapPin className="h-3 w-3 shrink-0 text-muted-foreground" />
          {o.is_remote ? 'Remote' : o.location || 'Not specified'}
        </span>
      ),
    },
    { label: 'Total first-year', render: (o) => moneyK(o.total_first_year), emphasize: true },
    { label: 'Recurring annual', render: (o) => moneyK(o.recurring_annual), emphasize: true },
  ]
  if (hasAnyTaxOrCol) {
    rows.push(
      { label: 'Est. tax rate', render: (o) => (o.estimated_tax_rate !== null ? formatPercent(o.estimated_tax_rate) : '—') },
      { label: 'Cost-of-living index', render: (o) => (o.col_index !== null ? formatMultiplier(o.col_index) : '—') }
    )
  }
  return rows
}

export function OffersPage() {
  const [offers, setOffers] = useState<Offer[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingOffer, setEditingOffer] = useState<Offer | null>(null)
  const [form, setForm] = useState<OfferFormValues>(EMPTY_FORM)
  const [ratingsForm, setRatingsForm] = useState<RatingsFormValues>(EMPTY_RATINGS)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [ratings, setRatings] = useState<Record<string, LocalRatings>>(() => loadAllRatings())
  const [weights, setWeights] = useState<Record<WeightKey, number>>(DEFAULT_WEIGHTS)

  const loadOffers = () => {
    setIsLoading(true)
    offersService
      .list()
      .then((data) => {
        setOffers(data.offers)
        setLoadError(false)
      })
      .catch((err) => {
        setLoadError(true)
        toast.error(errorMessage(err, 'Could not load your offers.'))
      })
      .finally(() => setIsLoading(false))
  }

  useEffect(() => {
    loadOffers()
  }, [])

  const setRating = (offerId: number, patch: LocalRatings) => {
    setRatings((prev) => {
      const next = { ...prev, [String(offerId)]: { ...prev[String(offerId)], ...patch } }
      persistRatings(next)
      return next
    })
  }

  const scoredOffers = useMemo(() => {
    if (offers.length === 0) return []
    const maxComp = Math.max(...offers.map((o) => o.net_adjusted_comp)) || 1
    const totalWeight = weights.compensation + weights.growth + weights.team + weights.flexibility || 1
    return offers.map((offer) => {
      const r = ratings[String(offer.id)] ?? {}
      // Unrated dimensions default to a neutral 5/10 rather than 0, so an
      // offer nobody has rated yet isn't penalized relative to one that has.
      const growth = r.growth ?? 5
      const team = r.team ?? 5
      const flexibility = r.flexibility ?? 5
      const compScore = (offer.net_adjusted_comp / maxComp) * 10
      const fit =
        (compScore * weights.compensation + growth * weights.growth + team * weights.team + flexibility * weights.flexibility) /
        totalWeight
      return { offer, fit, ratings: r }
    })
  }, [offers, weights, ratings])

  const winnerId = offers.length >= 2 ? [...scoredOffers].sort((a, b) => b.fit - a.fit)[0].offer.id : null
  const hasAnyTaxOrCol = offers.some((o) => o.estimated_tax_rate !== null || o.col_index !== null)
  const comparisonRows = useMemo(() => buildComparisonRows(hasAnyTaxOrCol), [hasAnyTaxOrCol])
  const highestFirstYear = offers.length > 0 ? Math.max(...offers.map((o) => o.total_first_year)) : 0

  const chartData = useMemo(
    () =>
      offers.map((o) => ({
        company: o.company,
        Base: Math.round(o.base_salary / 1000),
        Bonus: Math.round(o.annual_bonus / 1000),
        Equity: Math.round(o.equity_value_annual / 1000),
      })),
    [offers]
  )

  const totalWeightPct = weights.compensation + weights.growth + weights.team + weights.flexibility

  const negotiationInsights = useMemo(() => {
    if (offers.length < 2) return []
    const byTotal = [...offers].sort((a, b) => b.total_first_year - a.total_first_year)
    const byEquity = [...offers].sort((a, b) => b.equity_value_annual - a.equity_value_annual)
    const byBase = [...offers].sort((a, b) => b.base_salary - a.base_salary)
    const tips = [
      `${byTotal[0].company}'s total first-year comp leads the set at ${moneyK(byTotal[0].total_first_year)} — use it as an anchor when discussing the others.`,
    ]
    if (byEquity[0].equity_value_annual > 0 && byEquity[0].company !== byTotal[0].company) {
      tips.push(`${byEquity[0].company}'s equity is strongest at ${moneyK(byEquity[0].equity_value_annual)}/year — ask whether the grant can be increased based on a competing offer.`)
    }
    if (byBase[0].company !== byTotal[0].company) {
      tips.push(`${byBase[0].company}'s base salary leads the set — a useful anchor if you're negotiating base pay specifically.`)
    }
    if (hasAnyTaxOrCol) {
      tips.push('Compare net-adjusted figures, not just headline totals — your own tax-rate and cost-of-living entries change which offer actually goes furthest.')
    }
    return tips.slice(0, 3)
  }, [offers, hasAnyTaxOrCol])

  function openAddDialog() {
    setEditingOffer(null)
    setForm(EMPTY_FORM)
    setRatingsForm(EMPTY_RATINGS)
    setDialogOpen(true)
  }

  function openEditDialog(offer: Offer) {
    setEditingOffer(offer)
    setForm({
      company: offer.company,
      role_title: offer.role_title,
      base_salary: String(offer.base_salary),
      annual_bonus: String(offer.annual_bonus),
      signing_bonus: String(offer.signing_bonus),
      equity_value_annual: String(offer.equity_value_annual),
      location: offer.location ?? '',
      is_remote: offer.is_remote,
      notes: offer.notes ?? '',
      estimated_tax_rate_percent:
        offer.estimated_tax_rate !== null ? String(Math.round(offer.estimated_tax_rate * 10000) / 100) : '',
      col_index: offer.col_index !== null ? String(offer.col_index) : '',
    })
    const r = ratings[String(offer.id)] ?? {}
    setRatingsForm({
      growth: r.growth != null ? String(r.growth) : '',
      team: r.team != null ? String(r.team) : '',
      flexibility: r.flexibility != null ? String(r.flexibility) : '',
    })
    setDialogOpen(true)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()

    const company = form.company.trim()
    const roleTitle = form.role_title.trim()
    if (!company || !roleTitle) {
      toast.error('Company and role title are required.')
      return
    }

    const baseSalaryRaw = form.base_salary.trim()
    const baseSalary = baseSalaryRaw === '' ? NaN : Number(baseSalaryRaw)
    if (!Number.isFinite(baseSalary) || baseSalary < 0) {
      toast.error('Enter a valid base salary (0 or more).')
      return
    }

    const annualBonus = parseOptionalAmount(form.annual_bonus)
    const signingBonus = parseOptionalAmount(form.signing_bonus)
    const equity = parseOptionalAmount(form.equity_value_annual)
    if (annualBonus === null || signingBonus === null || equity === null) {
      toast.error('Bonus and equity amounts must be 0 or more.')
      return
    }

    const taxPercent = parseNullableNumber(form.estimated_tax_rate_percent)
    if (taxPercent === undefined) {
      toast.error('Estimated tax rate must be a number.')
      return
    }
    if (taxPercent !== null && (taxPercent < 0 || taxPercent > 100)) {
      toast.error('Estimated tax rate must be between 0 and 100.')
      return
    }

    const colIndex = parseNullableNumber(form.col_index)
    if (colIndex === undefined) {
      toast.error('Cost-of-living index must be a number.')
      return
    }
    if (colIndex !== null && colIndex <= 0) {
      toast.error('Cost-of-living index must be greater than 0.')
      return
    }

    const payload: OfferCreatePayload = {
      company,
      role_title: roleTitle,
      base_salary: baseSalary,
      annual_bonus: annualBonus,
      signing_bonus: signingBonus,
      equity_value_annual: equity,
      location: form.location.trim() || null,
      is_remote: form.is_remote,
      notes: form.notes.trim() || null,
      estimated_tax_rate: taxPercent === null ? null : taxPercent / 100,
      col_index: colIndex,
    }

    const localPatch: LocalRatings = {
      growth: parseRating(ratingsForm.growth),
      team: parseRating(ratingsForm.team),
      flexibility: parseRating(ratingsForm.flexibility),
    }

    setIsSubmitting(true)
    try {
      if (editingOffer) {
        const updated = await offersService.update(editingOffer.id, payload)
        setOffers((prev) => prev.map((o) => (o.id === updated.id ? updated : o)))
        setRating(updated.id, localPatch)
        toast.success(`Updated the ${updated.company} offer.`)
      } else {
        const created = await offersService.create(payload)
        setOffers((prev) => [created, ...prev])
        setRating(created.id, localPatch)
        toast.success(`Added the ${created.company} offer.`)
      }
      setDialogOpen(false)
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save that offer. Please try again.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDelete(offer: Offer) {
    setDeletingId(offer.id)
    try {
      await offersService.remove(offer.id)
      setOffers((prev) => prev.filter((o) => o.id !== offer.id))
      setRatings((prev) => {
        const next = { ...prev }
        delete next[String(offer.id)]
        persistRatings(next)
        return next
      })
      toast.success(`Removed the ${offer.company} offer.`)
    } catch (err) {
      toast.error(errorMessage(err, 'Could not delete that offer. Please try again.'))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="grid gap-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div>
          <h2 className="font-heading text-2xl font-bold text-foreground">Compare your offers</h2>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Balance compensation, growth, culture, and flexibility with your priorities.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {offers.length > 0 && (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-2 text-[10px] text-muted-foreground">
                <Gift size={14} className="text-primary" /> {offers.length} active offer{offers.length === 1 ? '' : 's'}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-2 text-[10px] text-muted-foreground">
                <Banknote size={14} className="text-primary" /> {moneyK(highestFirstYear)} highest total
              </span>
            </>
          )}
          <Button onClick={openAddDialog} className="gap-1.5">
            <Plus size={16} /> Add offer
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="grid gap-[18px]">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>
      )}

      {!isLoading && loadError && (
        <Card>
          <div className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-sm text-muted-foreground">Could not load your offers. Check the API and try again.</p>
            <Button variant="outline" size="sm" onClick={loadOffers}>
              Retry
            </Button>
          </div>
        </Card>
      )}

      {!isLoading && !loadError && offers.length === 0 && (
        <Card className="border-dashed">
          <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary text-primary">
              <Banknote className="h-7 w-7" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-bold text-foreground">No offers yet</h3>
              <p className="max-w-sm text-sm text-muted-foreground">
                Once you have an offer in hand, add it here. HireLoom breaks down total compensation and lets you
                compare offers side by side against your own priorities.
              </p>
            </div>
            <Button onClick={openAddDialog} className="gap-2">
              <Plus className="h-4 w-4" />
              Add your first offer
            </Button>
          </div>
        </Card>
      )}

      {!isLoading && !loadError && offers.length > 0 && (
        <>
          <div className="overflow-x-auto pb-1">
            <div
              className="grid items-stretch gap-2.5"
              style={{ gridTemplateColumns: `170px repeat(${offers.length}, minmax(220px, 1fr))` }}
            >
              <div className="pt-0">
                <div className="flex h-[105px] items-end pb-3.5 text-[13px] font-bold text-foreground">Offer details</div>
                {comparisonRows.map((row) => (
                  <div
                    key={row.label}
                    className="flex h-[50px] items-center gap-1 border-b border-border text-[10px] font-medium text-muted-foreground"
                  >
                    {row.label}
                  </div>
                ))}
                <div className="flex h-[50px] items-center border-b border-border text-[10px] font-medium text-muted-foreground">
                  Career growth
                </div>
                <div className="flex h-[50px] items-center border-b border-border text-[10px] font-medium text-muted-foreground">
                  Team &amp; culture
                </div>
                <div className="flex h-[50px] items-center border-b border-border text-[10px] font-medium text-muted-foreground">
                  Flexibility
                </div>
                <div className="flex h-[59px] items-center pt-2 text-[10px] font-medium text-muted-foreground">
                  Weighted fit
                </div>
              </div>

              {scoredOffers.map(({ offer, fit, ratings: r }) => (
                <Card
                  key={offer.id}
                  className={cn(
                    'relative overflow-hidden px-3.5',
                    offer.id === winnerId && 'border-primary shadow-[0_0_0_1px_theme(colors.primary.DEFAULT)]'
                  )}
                >
                  {offer.id === winnerId && (
                    <span className="absolute right-0 top-2.5 flex items-center gap-1 rounded-l-full bg-primary px-2 py-1 text-[7px] font-extrabold text-primary-foreground">
                      <Sparkles size={11} /> Best Fit
                    </span>
                  )}
                  <div className="grid h-[105px] grid-cols-[38px_1fr] content-center gap-x-2.5 pt-3.5">
                    <span className="row-span-2 grid h-[38px] w-[38px] place-items-center self-center rounded-md bg-foreground/80 font-heading text-[13px] font-bold text-white">
                      {initials(offer.company)}
                    </span>
                    <h3 className="self-end truncate text-[13px] font-bold text-foreground">{offer.company}</h3>
                    <p className="truncate text-[8px] text-muted-foreground">{offer.role_title}</p>
                  </div>

                  {comparisonRows.map((row) => (
                    <div
                      key={row.label}
                      className={cn(
                        'flex h-[50px] items-center gap-1 border-t border-border text-[11px] text-foreground',
                        row.emphasize && 'font-heading font-bold'
                      )}
                    >
                      {row.render(offer)}
                    </div>
                  ))}

                  {(['growth', 'team', 'flexibility'] as const).map((key) => (
                    <div key={key} className="flex h-[50px] items-center gap-2 border-t border-border">
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={r[key] ?? ''}
                        onChange={(e) => setRating(offer.id, { [key]: parseRating(e.target.value) })}
                        placeholder="—"
                        aria-label={`Your ${WEIGHT_LABELS[key === 'growth' ? 'growth' : key === 'team' ? 'team' : 'flexibility']} rating for ${offer.company}`}
                        className="h-7 w-12 rounded-md border border-border bg-card px-1.5 text-center text-[11px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <span className="text-[8px] text-muted-foreground">/10 · your rating</span>
                    </div>
                  ))}

                  <div className="h-[59px] border-t border-border pt-2.5">
                    <div className="flex items-baseline gap-1">
                      <strong className="font-heading text-[17px] font-extrabold text-primary">{fit.toFixed(1)}</strong>
                      <span className="text-[8px] text-muted-foreground">/10</span>
                    </div>
                    <div className="mt-1.5 h-1 rounded-full bg-secondary">
                      <span
                        className="block h-full rounded-full bg-primary transition-[width] duration-300"
                        style={{ width: `${Math.max(0, Math.min(100, fit * 10))}%` }}
                      />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>

          <div className="grid gap-[14px] lg:grid-cols-[1.35fr_.65fr]">
            <Card className="p-[18px]">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-2.5">
                  <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-lg bg-secondary text-primary">
                    <BarChart3 size={17} />
                  </span>
                  <div>
                    <h3 className="font-heading text-[15px] font-bold text-foreground">First-year total compensation</h3>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">Base, annual bonus, and annualized equity.</p>
                  </div>
                </div>
                <Badge variant="outline" className="shrink-0 text-[8px]">
                  USD · thousands
                </Badge>
              </div>
              <div className="mt-2.5 h-[230px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 12, right: 5, left: -15, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                    <XAxis dataKey="company" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 9 }}
                      tickFormatter={(value: number) => `$${value}k`}
                    />
                    <RechartsTooltip
                      contentStyle={{
                        borderRadius: 10,
                        border: '1px solid hsl(var(--border))',
                        fontSize: 12,
                      }}
                      formatter={(value: number) => `$${value}k`}
                    />
                    <Bar dataKey="Base" stackId="a" fill="hsl(var(--primary))" />
                    <Bar dataKey="Bonus" stackId="a" fill="hsl(var(--chart-indigo-soft))" />
                    <Bar dataKey="Equity" stackId="a" fill="hsl(var(--coral))" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-center gap-4">
                <span className="flex items-center gap-1.5 text-[8px] text-muted-foreground">
                  <i className="block h-1.5 w-1.5 rounded-sm bg-primary" /> Base
                </span>
                <span className="flex items-center gap-1.5 text-[8px] text-muted-foreground">
                  <i className="block h-1.5 w-1.5 rounded-sm bg-[hsl(var(--chart-indigo-soft))]" /> Bonus
                </span>
                <span className="flex items-center gap-1.5 text-[8px] text-muted-foreground">
                  <i className="block h-1.5 w-1.5 rounded-sm bg-coral" /> Equity
                </span>
              </div>
            </Card>

            <Card className="p-[18px]">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-2.5">
                  <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-lg bg-secondary text-primary">
                    <Scale size={17} />
                  </span>
                  <div>
                    <h3 className="font-heading text-[15px] font-bold text-foreground">Your priorities</h3>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">Adjust weights to recalculate Best Fit instantly.</p>
                  </div>
                </div>
                <strong className={cn('font-heading text-[13px] font-extrabold', totalWeightPct === 100 ? 'text-primary' : 'text-warning')}>
                  {totalWeightPct}%
                </strong>
              </div>
              <div className="mt-[22px] grid gap-[15px]">
                {(Object.keys(WEIGHT_LABELS) as WeightKey[]).map((key) => (
                  <label key={key} className="grid gap-1.5">
                    <div className="flex justify-between text-[9px] text-muted-foreground">
                      <span>{WEIGHT_LABELS[key]}</span>
                      <strong className="font-heading text-foreground">{weights[key]}%</strong>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={60}
                      value={weights[key]}
                      onChange={(e) => setWeights((w) => ({ ...w, [key]: Number(e.target.value) }))}
                      className="w-full accent-primary"
                    />
                  </label>
                ))}
              </div>
              <p className="mt-3 text-[8px] italic text-muted-foreground">
                Compensation is computed from your real offer figures. Growth, team, and flexibility use your own
                1–10 ratings, entered per offer above (or defaulted to a neutral 5 until rated) — stored on this
                device only, not on your account.
              </p>
            </Card>
          </div>

          {negotiationInsights.length > 0 && (
            <Card className="grid gap-4 bg-gradient-to-br from-card to-coral-tint p-5 sm:grid-cols-[1fr_1.6fr]">
              <div className="flex items-start gap-2.5">
                <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-lg bg-card text-coral">
                  <Sparkles size={19} />
                </span>
                <div>
                  <h3 className="font-heading text-[14px] font-bold text-foreground">Negotiation insights</h3>
                  <p className="mt-0.5 text-[9px] text-muted-foreground">
                    Computed from the real numbers you entered above — not an AI-generated plan.
                  </p>
                </div>
              </div>
              <div className="grid gap-2">
                {negotiationInsights.map((tip, index) => (
                  <div key={tip} className="grid grid-cols-[20px_1fr] items-start gap-2">
                    <span className="grid h-[18px] w-[18px] place-items-center rounded-md bg-card text-[7px] font-extrabold text-coral-foreground">
                      {index + 1}
                    </span>
                    <p className="text-[9px] text-muted-foreground">{tip}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card className="p-4">
            <div className="flex items-center justify-between gap-3 pb-2">
              <h3 className="text-sm font-bold text-foreground">Manage offers</h3>
            </div>
            <div className="grid gap-2">
              {offers.map((offer) => (
                <div
                  key={offer.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                >
                  <span className="text-xs font-semibold text-foreground">
                    {offer.company} <span className="font-normal text-muted-foreground">· {offer.role_title}</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" className="gap-1" onClick={() => openEditDialog(offer)}>
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 text-destructive hover:bg-destructive/10"
                      disabled={deletingId === offer.id}
                      onClick={() => handleDelete(offer)}
                    >
                      {deletingId === offer.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto rounded-xl p-[21px]">
          <DialogHeader className="space-y-0.5">
            <DialogTitle className="font-heading text-lg font-bold text-foreground">
              {editingOffer ? 'Edit offer' : 'Add an offer'}
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              Enter the figures as offered. HireLoom computes the first-year and net-adjusted totals automatically.
            </p>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="grid gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="company">Company</Label>
                <Input
                  id="company"
                  value={form.company}
                  onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
                  placeholder="e.g. Figma"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="role_title">Role title</Label>
                <Input
                  id="role_title"
                  value={form.role_title}
                  onChange={(e) => setForm((f) => ({ ...f, role_title: e.target.value }))}
                  placeholder="e.g. Senior Product Designer"
                  required
                />
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="base_salary">Base salary</Label>
                <Input
                  id="base_salary"
                  type="number"
                  min="0"
                  step="1000"
                  inputMode="numeric"
                  value={form.base_salary}
                  onChange={(e) => setForm((f) => ({ ...f, base_salary: e.target.value }))}
                  placeholder="150000"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="annual_bonus">Annual bonus</Label>
                <Input
                  id="annual_bonus"
                  type="number"
                  min="0"
                  step="1000"
                  inputMode="numeric"
                  value={form.annual_bonus}
                  onChange={(e) => setForm((f) => ({ ...f, annual_bonus: e.target.value }))}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signing_bonus">Signing bonus</Label>
                <Input
                  id="signing_bonus"
                  type="number"
                  min="0"
                  step="1000"
                  inputMode="numeric"
                  value={form.signing_bonus}
                  onChange={(e) => setForm((f) => ({ ...f, signing_bonus: e.target.value }))}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="equity_value_annual">Equity (per year)</Label>
                <Input
                  id="equity_value_annual"
                  type="number"
                  min="0"
                  step="1000"
                  inputMode="numeric"
                  value={form.equity_value_annual}
                  onChange={(e) => setForm((f) => ({ ...f, equity_value_annual: e.target.value }))}
                  placeholder="0"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="location">Location</Label>
                <Input
                  id="location"
                  value={form.location}
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                  placeholder="e.g. Austin, TX"
                  disabled={form.is_remote}
                />
              </div>
              <div className="flex items-center gap-2 pb-2">
                <Checkbox
                  id="is_remote"
                  checked={form.is_remote}
                  onCheckedChange={(checked) => setForm((f) => ({ ...f, is_remote: checked === true }))}
                />
                <Label htmlFor="is_remote" className="cursor-pointer font-normal">
                  This role is remote
                </Label>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="estimated_tax_rate_percent">Est. tax rate (optional)</Label>
                <Input
                  id="estimated_tax_rate_percent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  inputMode="decimal"
                  value={form.estimated_tax_rate_percent}
                  onChange={(e) => setForm((f) => ({ ...f, estimated_tax_rate_percent: e.target.value }))}
                  placeholder="e.g. 24"
                />
                <p className="text-[11px] text-muted-foreground">As a percent, e.g. 24 for 24%.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="col_index">Cost-of-living index (optional)</Label>
                <Input
                  id="col_index"
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  value={form.col_index}
                  onChange={(e) => setForm((f) => ({ ...f, col_index: e.target.value }))}
                  placeholder="e.g. 1.15"
                />
                <p className="text-[11px] text-muted-foreground">Relative to your baseline city, e.g. 1.15.</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Vesting schedule, relocation package, deadline to respond, etc."
                rows={3}
              />
            </div>

            <Separator />

            <div>
              <Label className="text-sm">Your ratings (optional)</Label>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                1–10, your own judgment call — stored on this device only, used to compute Best Fit alongside the
                real compensation figures above.
              </p>
              <div className="mt-2.5 grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="rating-growth">Career growth</Label>
                  <Input
                    id="rating-growth"
                    type="number"
                    min="1"
                    max="10"
                    value={ratingsForm.growth}
                    onChange={(e) => setRatingsForm((f) => ({ ...f, growth: e.target.value }))}
                    placeholder="—"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rating-team">Team &amp; culture</Label>
                  <Input
                    id="rating-team"
                    type="number"
                    min="1"
                    max="10"
                    value={ratingsForm.team}
                    onChange={(e) => setRatingsForm((f) => ({ ...f, team: e.target.value }))}
                    placeholder="—"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rating-flexibility">Flexibility</Label>
                  <Input
                    id="rating-flexibility"
                    type="number"
                    min="1"
                    max="10"
                    value={ratingsForm.flexibility}
                    onChange={(e) => setRatingsForm((f) => ({ ...f, flexibility: e.target.value }))}
                    placeholder="—"
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting} className="gap-2">
                {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {editingOffer ? 'Save changes' : 'Add offer'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
