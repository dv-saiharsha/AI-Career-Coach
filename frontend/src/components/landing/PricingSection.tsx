'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useInView } from 'react-intersection-observer';
import { Check, Zap, Building2, Sparkles, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useAccentPalette } from '../../lib/useAccentPalette';

function buildPlans(palette: ReturnType<typeof useAccentPalette>) { return [
  {
    name: 'Starter',
    icon: Zap,
    monthly: 0,
    annual: 0,
    desc: 'Perfect for getting started and landing your first role.',
    color: palette.inkDim,
    features: [
      '3 Resume Analyses / month',
      'ATS Score & Keyword Match',
      'Basic Skill Gap Report',
      '5 Mock Interview Questions',
      'Community Support',
    ],
    cta: 'Get started free',
    href: '/register',
    highlight: false,
  },
  {
    name: 'Professional',
    icon: Sparkles,
    monthly: 19,
    annual: 15.17,
    desc: 'For serious job seekers who want every advantage.',
    color: palette.accent,
    features: [
      'Unlimited Resume Analyses',
      'Deep ATS Analysis + Rewrites',
      'Full Skill Gap Roadmap',
      'Unlimited Mock Interviews',
      'AI Answer Evaluation',
      'Communication & Confidence Scores',
      'PDF Report Export',
      'Session History & Analytics',
      'Priority Support',
    ],
    cta: 'Start 7-day free trial',
    href: '/register?plan=pro',
    highlight: true,
  },
  {
    name: 'Enterprise',
    icon: Building2,
    monthly: null,
    annual: null,
    desc: 'For teams, bootcamps, and recruiting platforms.',
    color: palette.accentLighter,
    features: [
      'Everything in Professional',
      'Team Dashboard',
      'Bulk Resume Processing',
      'Custom Question Banks',
      'API Access',
      'White-label Option',
      'Dedicated Account Manager',
      'SLA Guarantee',
      'Custom Integrations',
    ],
    cta: 'Contact Sales',
    href: '/contact',
    highlight: false,
  },
]; }

export function PricingSection() {
  const { ref, inView } = useInView({ threshold: 0.05, triggerOnce: true });
  const [annual, setAnnual] = useState(false);
  const palette = useAccentPalette();
  const PLANS = buildPlans(palette);

  return (
    <section id="pricing" className="py-24 px-4 border-t border-[var(--color-canvas-line-soft)] relative bg-[var(--color-canvas-deep)]">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[var(--color-accent)]/[0.03] to-transparent pointer-events-none" />

      <div className="max-w-6xl mx-auto">
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-10"
        >
          <span className="section-eyebrow-violet mb-4 inline-flex">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
            Pricing
          </span>
          <h2 className="text-4xl md:text-5xl font-display font-semibold tracking-tight mt-4 mb-5">
            Simple, transparent
            <br />
            <span className="gradient-text-violet">pricing</span>
          </h2>
          <p className="text-[var(--color-ink-dim)] text-lg max-w-xl mx-auto mb-8">
            Start free. Upgrade when you&apos;re ready. Cancel anytime.
          </p>

          {/* Monthly / Annual toggle */}
          <div className="inline-flex items-center gap-3 bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line)] rounded-full p-1.5">
            <button
              onClick={() => setAnnual(false)}
              aria-pressed={!annual}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                !annual ? 'bg-[var(--color-accent)] text-[var(--color-ink)]' : 'text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setAnnual(true)}
              aria-pressed={annual}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                annual ? 'bg-[var(--color-accent)] text-[var(--color-ink)]' : 'text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]'
              }`}
            >
              Annual
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${annual ? 'bg-white/20' : 'bg-[var(--color-accent)]/15 text-[var(--color-accent-lighter)]'}`}>
                Save 20%
              </span>
            </button>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {PLANS.map((plan, i) => {
            const Icon = plan.icon;
            const price = plan.monthly === null ? 'Custom' : plan.monthly === 0 ? 'Free' : `$${(annual ? plan.annual : plan.monthly)?.toFixed(annual ? 2 : 0)}`;
            const period = plan.monthly ? '/ month' : '';
            return (
              <motion.div
                key={plan.name}
                initial={{ opacity: 0, y: 32 }}
                animate={inView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.6, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}
                className={`relative flex flex-col rounded-2xl p-7 border transition-all duration-300 ${
                  plan.highlight
                    ? 'bg-[color-mix(in_srgb,var(--color-accent)_10%,var(--color-canvas))] border-[var(--color-accent)]/40 shadow-[0_0_60px_rgba(var(--color-accent-rgb),0.15)]'
                    : 'bg-[var(--color-canvas-raise)] border-[var(--color-canvas-line-soft)] hover:border-[var(--color-canvas-line)]'
                }`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-dim)] text-white text-xs font-bold px-4 py-1.5 rounded-full shadow-lg">
                    Most Popular
                  </div>
                )}

                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center mb-5"
                  style={{ backgroundColor: `${plan.color}15`, border: `1px solid ${plan.color}25` }}
                >
                  <Icon className="w-5 h-5" style={{ color: plan.color }} />
                </div>

                <div className="mb-1">
                  <span className="text-sm font-mono text-[var(--color-ink-faint)] uppercase tracking-widest">{plan.name}</span>
                </div>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-4xl font-display font-bold text-[var(--color-ink)] tabular-nums">{price}</span>
                  <span className="text-[var(--color-ink-faint)] text-sm">{period}</span>
                </div>
                {plan.monthly ? (
                  <div className="text-xs text-[var(--color-ink-faint)] mb-6 h-4">
                    {annual ? `Billed $${(plan.annual! * 12).toFixed(0)} / year` : 'Billed monthly'}
                  </div>
                ) : (
                  <div className="mb-6 h-4" />
                )}
                <p className="text-sm text-[var(--color-ink-dim)] mb-7 leading-relaxed">{plan.desc}</p>

                <ul className="space-y-3 flex-1 mb-8">
                  {plan.features.map((feat) => (
                    <li key={feat} className="flex items-start gap-3 text-sm text-[var(--color-ink-dim)]">
                      <Check className="w-4 h-4 mt-0.5 shrink-0" style={{ color: plan.color }} />
                      {feat}
                    </li>
                  ))}
                </ul>

                <Link
                  href={plan.href}
                  className={`flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all ${
                    plan.highlight
                      ? 'bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-dim)] text-white shadow-[0_0_20px_rgba(var(--color-accent-rgb),0.35)] hover:shadow-[0_0_30px_rgba(var(--color-accent-rgb),0.55)] hover:scale-[1.02]'
                      : 'border border-[var(--color-canvas-line)] text-[var(--color-ink)] hover:bg-[var(--color-canvas-raise)] hover:border-[var(--color-ink-faint)]'
                  }`}
                >
                  {plan.cta}
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </motion.div>
            );
          })}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ delay: 0.5 }}
          className="text-center text-xs text-[var(--color-ink-faint)] mt-8"
        >
          All plans include a 7-day free trial. No credit card required to start.
        </motion.p>
      </div>
    </section>
  );
}
