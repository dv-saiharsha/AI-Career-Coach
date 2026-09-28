import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { ArrowRight, Check, CreditCard, Download, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Logo } from '@/components/shared/Logo'
import { WovenPattern } from '@/components/shared/WovenPattern'
import { useAuth } from '@/context/AuthContext'

// Prototype "success" screen for the prototype checkout — see
// CheckoutPage.tsx. No real payment was taken, no real subscription was
// created; this is a fabricated receipt, ported verbatim from
// figma-landing's PaymentSuccess.tsx at your direct request.
const PAYMENT_PLANS = {
  pro: { name: 'Pro', monthly: 19, yearly: 182 },
  premium: { name: 'Premium', monthly: 39, yearly: 374 },
} as const

export function PaymentSuccessPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const planKey = params.get('plan') === 'premium' ? 'premium' : 'pro'
  const plan = PAYMENT_PLANS[planKey]
  const yearly = params.get('billing') !== 'monthly'
  const amountPaid = (yearly ? plan.yearly : plan.monthly) * 1.0825

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,hsl(var(--secondary)),hsl(var(--background)))] p-[25px]">
      <header className="mx-auto w-[min(100%,720px)]">
        <Link to="/">
          <Logo />
        </Link>
      </header>
      <main className="mx-auto my-[55px] grid w-[min(100%,660px)] gap-3">
        <Card className="relative flex flex-col items-center overflow-hidden p-[42px] text-center">
          <WovenPattern className="text-primary opacity-[0.04]" />
          <span className="mb-[15px] grid h-[58px] w-[58px] place-items-center rounded-full bg-success text-white shadow-[0_0_0_8px_hsl(var(--success-tint))]">
            <Check size={27} />
          </span>
          <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-success">Payment successful</span>
          <h1 className="mt-2 font-heading text-[27px] font-extrabold">Welcome to HireLoom {plan.name}.</h1>
          <p className="max-w-[520px] text-[10px] text-muted-foreground">
            Your plan is active now. You have immediate access to{' '}
            {planKey === 'premium'
              ? 'unlimited coaching, priority matches, and offer negotiation'
              : 'unlimited preparation tools and advanced career insights'}
            .
          </p>

          <div className="my-[19px] w-full rounded-[9px] border border-border bg-background px-4 py-2">
            <div className="flex min-h-[38px] items-center justify-between border-b border-border text-[8px]">
              <span className="text-muted-foreground">Plan</span>
              <strong className="flex items-center gap-1.5">
                {plan.name} · {yearly ? 'Annual' : 'Monthly'}
              </strong>
            </div>
            <div className="flex min-h-[38px] items-center justify-between border-b border-border text-[8px]">
              <span className="text-muted-foreground">Amount paid</span>
              <strong className="flex items-center gap-1.5">${amountPaid.toFixed(2)}</strong>
            </div>
            <div className="flex min-h-[38px] items-center justify-between border-b border-border text-[8px]">
              <span className="text-muted-foreground">Payment method</span>
              <strong className="flex items-center gap-1.5">
                <CreditCard size={14} /> •••• 4242
              </strong>
            </div>
            <div className="flex min-h-[38px] items-center justify-between text-[8px]">
              <span className="text-muted-foreground">Receipt</span>
              <Button variant="ghost" size="sm">
                <Download size={13} /> Download PDF
              </Button>
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={() => navigate('/dashboard')}>
              Go to dashboard <ArrowRight size={15} />
            </Button>
            <Button variant="outline" onClick={() => navigate('/settings')}>
              Manage subscription
            </Button>
          </div>
          <small className="mt-[13px] text-[7px] text-muted-foreground">
            A receipt has been sent to {user?.email || 'your account email'}.
          </small>
        </Card>

        <Card className="grid grid-cols-[28px_1fr_auto] items-center gap-2 p-[14px]">
          <Sparkles size={18} className="text-coral" />
          <div>
            <strong className="text-[9px]">Your recommended next step</strong>
            <p className="mt-0.5 text-[7px] text-muted-foreground">Run a fresh resume analysis to unlock your first Pro recommendation.</p>
          </div>
          <Button variant="ghost" onClick={() => navigate('/resume')}>
            Analyze resume <ArrowRight size={14} />
          </Button>
        </Card>
      </main>
    </div>
  )
}
