import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check, CreditCard, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Logo } from '@/components/shared/Logo'
import { useAuth } from '@/context/AuthContext'
import { cn } from '@/lib/utils'

// Prototype checkout, ported verbatim from figma-landing's Checkout.tsx at
// your direct request ("match the picture exactly") — there is no payment
// processor wired up anywhere in the backend. Nothing here ever charges a
// real card; the "Processing securely…" delay and the success receipt are
// both fabricated. The demo-note banner in the summary column discloses
// this in the UI itself, same as the source design does.
const PAYMENT_PLANS = {
  pro: {
    name: 'Pro',
    monthly: 19,
    yearly: 182,
    description: 'Unlimited preparation tools for a focused job search.',
    features: ['Unlimited resume analyses', '10 AI interview sessions monthly', 'Tailored cover letters', 'Advanced progress insights'],
  },
  premium: {
    name: 'Premium',
    monthly: 39,
    yearly: 374,
    description: 'End-to-end support from preparation through negotiation.',
    features: ['Unlimited AI coaching', 'Priority job matches', 'Offer comparison and negotiation', 'Everything included in Pro'],
  },
} as const

const TRUST_POINTS = ['Secure encrypted checkout', 'Cancel anytime', '14-day money-back guarantee'] as const

const COUNTRIES = ['United States', 'Canada', 'United Kingdom', 'Australia'] as const

function splitName(fullName: string): { first: string; last: string } {
  const trimmed = fullName.trim()
  if (!trimmed) return { first: '', last: '' }
  const parts = trimmed.split(/\s+/)
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

export function CheckoutPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { first: initialFirst, last: initialLast } = splitName(user?.fullName ?? '')

  const initialPlan = params.get('plan') === 'premium' ? 'premium' : 'pro'
  const [planKey, setPlanKey] = useState<'pro' | 'premium'>(initialPlan)
  const [yearly, setYearly] = useState(params.get('billing') !== 'monthly')
  const [method, setMethod] = useState<'card' | 'paypal'>('card')
  const [processing, setProcessing] = useState(false)
  const [country, setCountry] = useState<string>('United States')
  const [saveMethod, setSaveMethod] = useState(true)

  const plan = PAYMENT_PLANS[planKey]
  const subtotal = yearly ? plan.yearly : plan.monthly
  const tax = useMemo(() => Number((subtotal * 0.0825).toFixed(2)), [subtotal])
  const total = subtotal + tax

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setProcessing(true)
    window.setTimeout(() => {
      navigate(`/payment/success?plan=${planKey}&billing=${yearly ? 'yearly' : 'monthly'}`)
    }, 1100)
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="flex h-[70px] items-center justify-between border-b border-border bg-card px-[max(24px,calc((100vw-1100px)/2))]">
        <Link to="/">
          <Logo />
        </Link>
        <span className="flex items-center gap-[5px] text-[8px] text-muted-foreground">
          <LockKeyhole size={14} /> Secure checkout
        </span>
      </header>

      <main className="mx-auto my-9 mb-[70px] grid w-[min(calc(100%-40px),1100px)] grid-cols-[1fr_360px] items-start gap-7 max-[820px]:grid-cols-1">
        <section>
          <Button variant="ghost" className="px-0" onClick={() => navigate('/#pricing')}>
            <ArrowLeft size={15} /> Back to pricing
          </Button>

          <div className="my-5 mb-[25px]">
            <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-primary">Complete your upgrade</span>
            <h1 className="mt-2 max-w-[650px] font-heading text-[29px] font-extrabold">
              Start moving faster with HireLoom {plan.name}.
            </h1>
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Review your plan, enter payment details, and begin immediately.
            </p>
          </div>

          <form onSubmit={submit} className="grid gap-[13px]">
            <Card className="p-5">
              <div className="flex items-center gap-2.5 border-b border-border pb-[15px]">
                <span className="grid h-[27px] w-[27px] place-items-center rounded-lg bg-secondary font-heading text-[9px] font-extrabold text-primary">
                  1
                </span>
                <div>
                  <h2 className="font-heading text-[13px] font-bold">Choose your plan</h2>
                  <p className="mt-0.5 text-[8px] text-muted-foreground">You can change or cancel at any time.</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-[9px]">
                {(['pro', 'premium'] as const).map((key) => (
                  <button
                    type="button"
                    key={key}
                    onClick={() => setPlanKey(key)}
                    className={cn(
                      'flex min-h-[77px] items-center justify-between gap-2 rounded-md border border-border bg-card p-3 text-left transition-colors hover:bg-secondary',
                      planKey === key && 'border-primary bg-secondary shadow-[0_0_0_1px_hsl(var(--primary))]'
                    )}
                  >
                    <span className="grid">
                      <strong className="text-[10px] text-foreground">{PAYMENT_PLANS[key].name}</strong>
                      <small className="mt-1 max-w-[200px] text-[7px] leading-[1.4] text-muted-foreground">
                        {PAYMENT_PLANS[key].description}
                      </small>
                    </span>
                    <strong className="font-heading text-[15px] font-extrabold text-primary">
                      ${yearly ? Math.round(PAYMENT_PLANS[key].yearly / 12) : PAYMENT_PLANS[key].monthly}
                      <small className="font-sans text-[7px] font-semibold text-muted-foreground">/mo</small>
                    </strong>
                  </button>
                ))}
              </div>
              <div className="mt-3 flex w-fit rounded-lg bg-background p-[3px]">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn('text-[8px]', !yearly && 'bg-card text-primary shadow-soft')}
                  onClick={() => setYearly(false)}
                >
                  Monthly
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn('text-[8px]', yearly && 'bg-card text-primary shadow-soft')}
                  onClick={() => setYearly(true)}
                >
                  Yearly <span className="ml-1 text-[6.5px] text-success">Save 20%</span>
                </Button>
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-center gap-2.5 border-b border-border pb-[15px]">
                <span className="grid h-[27px] w-[27px] place-items-center rounded-lg bg-secondary font-heading text-[9px] font-extrabold text-primary">
                  2
                </span>
                <div>
                  <h2 className="font-heading text-[13px] font-bold">Billing information</h2>
                  <p className="mt-0.5 text-[8px] text-muted-foreground">Used for receipts and account verification.</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-[13px]">
                <Label className="grid gap-1.5 text-[10px]">
                  First name
                  <Input defaultValue={initialFirst || undefined} placeholder="First name" required />
                </Label>
                <Label className="grid gap-1.5 text-[10px]">
                  Last name
                  <Input defaultValue={initialLast || undefined} placeholder="Last name" required />
                </Label>
                <Label className="col-span-2 grid gap-1.5 text-[10px]">
                  Email address
                  <Input type="email" defaultValue={user?.email || undefined} placeholder="you@example.com" required />
                </Label>
                <Label className="col-span-2 grid gap-1.5 text-[10px]">
                  Country or region
                  <Select value={country} onValueChange={setCountry}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COUNTRIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Label>
                <Label className="col-span-2 grid gap-1.5 text-[10px]">
                  Billing address
                  <Input placeholder="Street address" required />
                </Label>
                <Label className="grid gap-1.5 text-[10px]">
                  City
                  <Input placeholder="San Francisco" required />
                </Label>
                <Label className="grid gap-1.5 text-[10px]">
                  Postal code
                  <Input placeholder="94107" required />
                </Label>
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-center gap-2.5 border-b border-border pb-[15px]">
                <span className="grid h-[27px] w-[27px] place-items-center rounded-lg bg-secondary font-heading text-[9px] font-extrabold text-primary">
                  3
                </span>
                <div>
                  <h2 className="font-heading text-[13px] font-bold">Payment method</h2>
                  <p className="mt-0.5 text-[8px] text-muted-foreground">Your payment information is encrypted.</p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMethod('card')}
                  className={cn(
                    'flex min-h-[38px] items-center gap-2 rounded-md border border-border bg-card px-3 text-[11px] font-bold text-foreground transition-colors hover:bg-secondary',
                    method === 'card' && 'border-primary bg-secondary text-primary'
                  )}
                >
                  <CreditCard size={17} /> Credit or debit card
                  <span className="ml-auto grid h-[18px] w-[18px] place-items-center rounded-full bg-primary text-white">
                    {method === 'card' && <Check size={12} />}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setMethod('paypal')}
                  className={cn(
                    'flex min-h-[38px] items-center gap-2 rounded-md border border-border bg-card px-3 text-[11px] font-bold text-foreground transition-colors hover:bg-secondary',
                    method === 'paypal' && 'border-primary bg-secondary text-primary'
                  )}
                >
                  <strong>Pay</strong>Pal
                  <span className="ml-auto grid h-[18px] w-[18px] place-items-center rounded-full bg-primary text-white">
                    {method === 'paypal' && <Check size={12} />}
                  </span>
                </button>
              </div>

              {method === 'card' ? (
                <div className="mt-4 grid grid-cols-2 gap-[13px]">
                  <Label className="col-span-2 grid gap-1.5 text-[10px]">
                    Card number
                    <div className="relative">
                      <CreditCard size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input inputMode="numeric" placeholder="4242 4242 4242 4242" className="pl-[39px]" required />
                    </div>
                  </Label>
                  <Label className="grid gap-1.5 text-[10px]">
                    Expiration
                    <Input placeholder="MM / YY" required />
                  </Label>
                  <Label className="grid gap-1.5 text-[10px]">
                    Security code
                    <Input inputMode="numeric" placeholder="CVC" required />
                  </Label>
                  <div className="col-span-2 flex items-center gap-2">
                    <Checkbox id="save-payment-method" checked={saveMethod} onCheckedChange={(checked) => setSaveMethod(checked === true)} />
                    <label htmlFor="save-payment-method" className="text-[8px] text-muted-foreground">
                      Save this payment method securely for future renewals.
                    </label>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-lg bg-secondary p-[17px] text-center">
                  <strong className="text-[10px]">Continue securely with PayPal</strong>
                  <p className="mt-1 text-[8px] text-muted-foreground">
                    You&rsquo;ll complete authorization in PayPal before returning to HireLoom.
                  </p>
                </div>
              )}
            </Card>

            <Button className="min-h-[49px] w-full" disabled={processing} type="submit">
              {processing ? (
                <>
                  <span className="h-[15px] w-[15px] animate-spin rounded-full border-2 border-white/40 border-t-white" /> Processing
                  securely…
                </>
              ) : (
                <>
                  Start {plan.name} · ${total.toFixed(2)} <LockKeyhole size={15} />
                </>
              )}
            </Button>
            <p className="mx-auto max-w-[600px] text-center text-[7px] text-muted-foreground">
              By completing your purchase, you agree to the HireLoom Terms of Service and authorize recurring charges until canceled.
            </p>
          </form>
        </section>

        <aside className="sticky top-[25px] grid gap-[13px] max-[820px]:static max-[820px]:row-start-1">
          <Card className="p-[21px]">
            <div className="flex items-center gap-2.5">
              <span className="grid h-[38px] w-[38px] place-items-center rounded-[10px] bg-coral-tint text-coral">
                <Sparkles size={17} />
              </span>
              <div>
                <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-primary">Order summary</span>
                <h2 className="mt-0.5 font-heading text-[15px] font-bold">HireLoom {plan.name}</h2>
              </div>
            </div>
            <p className="mt-3 text-[8px] text-muted-foreground">{plan.description}</p>
            <div className="my-4 grid gap-2 border-y border-border py-4">
              {plan.features.map((feature) => (
                <span key={feature} className="flex items-center gap-1.5 text-[8px] text-foreground/80">
                  <Check size={12} className="text-success" /> {feature}
                </span>
              ))}
            </div>
            <div className="grid gap-[9px]">
              <div className="flex justify-between text-[8px] text-muted-foreground">
                <span>
                  {plan.name} · {yearly ? 'Annual' : 'Monthly'}
                </span>
                <strong className="text-foreground">${subtotal.toFixed(2)}</strong>
              </div>
              <div className="flex justify-between text-[8px] text-muted-foreground">
                <span>Estimated tax</span>
                <strong className="text-foreground">${tax.toFixed(2)}</strong>
              </div>
              <div className="flex justify-between border-t border-border pt-[10px] text-[10px] text-foreground">
                <span>Total due today</span>
                <strong className="font-heading text-[15px] font-extrabold">${total.toFixed(2)}</strong>
              </div>
              {yearly && (
                <small className="text-[7px] text-muted-foreground">
                  Equivalent to ${Math.round(plan.yearly / 12)}/month. Renews annually.
                </small>
              )}
            </div>
          </Card>

          <div className="grid gap-2 px-3 py-[3px]">
            {TRUST_POINTS.map((point, index) => (
              <span key={point} className="flex items-center gap-1.5 text-[8px] text-foreground/80">
                {index === 0 ? <ShieldCheck size={15} className="text-success" /> : <Check size={15} className="text-success" />}
                {point}
              </span>
            ))}
          </div>

          <p className="m-0 rounded-md bg-warning-tint p-[9px] text-center text-[7px] text-warning">
            Prototype checkout: no real payment will be processed.
          </p>
        </aside>
      </main>
    </div>
  )
}
