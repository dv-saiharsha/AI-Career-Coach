'use client';

import { motion } from 'framer-motion';
import { Check, X, Zap, Sparkles, Building2 } from 'lucide-react';
import { PricingSection } from '../../components/landing/PricingSection';
import { FAQSection } from '../../components/landing/FAQSection';
import { CTASection } from '../../components/landing/CTASection';
import { useAccentPalette } from '../../lib/useAccentPalette';

function buildPlanColumns(palette: ReturnType<typeof useAccentPalette>) { return [
  { name: 'Starter', icon: Zap, color: palette.inkDim, highlight: false },
  { name: 'Professional', icon: Sparkles, color: palette.accent, highlight: true },
  { name: 'Enterprise', icon: Building2, color: palette.accentLighter, highlight: false },
]; }

const COMPARISON_GROUPS = [
  {
    label: 'Resume Analyzer',
    rows: [
      { feature: 'Resume Analyses', starter: '3 / month', pro: 'Unlimited', enterprise: 'Unlimited' },
      { feature: 'ATS Score & Match', starter: true, pro: true, enterprise: true },
      { feature: 'Keyword Analysis', starter: true, pro: true, enterprise: true },
      { feature: 'Basic Skill Gap', starter: true, pro: true, enterprise: true },
      { feature: 'Deep Skill Roadmap', starter: false, pro: true, enterprise: true },
      { feature: 'AI Resume Rewrites', starter: false, pro: true, enterprise: true },
      { feature: 'PDF Report Export', starter: false, pro: true, enterprise: true },
    ],
  },
  {
    label: 'Interview Coach',
    rows: [
      { feature: 'Mock Interviews', starter: '5 / month', pro: 'Unlimited', enterprise: 'Unlimited' },
      { feature: 'AI Answer Evaluation', starter: false, pro: true, enterprise: true },
      { feature: 'Communication Score', starter: false, pro: true, enterprise: true },
      { feature: 'Confidence Score', starter: false, pro: true, enterprise: true },
      { feature: 'Session History', starter: '7 days', pro: 'Forever', enterprise: 'Forever' },
      { feature: 'Performance Analytics', starter: false, pro: true, enterprise: true },
    ],
  },
  {
    label: 'Teams & Enterprise',
    rows: [
      { feature: 'Team Dashboard', starter: false, pro: false, enterprise: true },
      { feature: 'Bulk Processing', starter: false, pro: false, enterprise: true },
      { feature: 'API Access', starter: false, pro: false, enterprise: true },
      { feature: 'Custom Question Banks', starter: false, pro: false, enterprise: true },
      { feature: 'White-label Option', starter: false, pro: false, enterprise: true },
      { feature: 'SLA Guarantee', starter: false, pro: false, enterprise: true },
      { feature: 'Support', starter: 'Community', pro: 'Priority email', enterprise: 'Dedicated manager' },
    ],
  },
];

function Cell({ value }: { value: boolean | string }) {
  if (typeof value === 'boolean') {
    return value ? (
      <span className="inline-flex w-6 h-6 rounded-full bg-[var(--color-accent)]/12 items-center justify-center">
        <Check className="w-3.5 h-3.5 text-[var(--color-accent)]" />
      </span>
    ) : (
      <span className="inline-flex w-6 h-6 rounded-full items-center justify-center">
        <X className="w-3.5 h-3.5 text-[var(--color-canvas-line)]" />
      </span>
    );
  }
  return <span className="text-sm text-[var(--color-ink-dim)]">{value}</span>;
}

export function PricingPageClient() {
  const palette = useAccentPalette();
  const PLAN_COLUMNS = buildPlanColumns(palette);
  return (
    <main>
      {/* Hero */}
      <section className="relative overflow-hidden pt-36 pb-8 px-4">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[420px] bg-[var(--color-accent)]/8 rounded-full blur-[160px] pointer-events-none" />
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="max-w-3xl mx-auto text-center relative"
        >
          <span className="eyebrow mb-4 inline-flex">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
            Pricing
          </span>
          <h1 className="text-4xl sm:text-5xl md:text-7xl font-display font-semibold tracking-tight mt-4 mb-5">
            Invest in your career.
            <br />
            <span className="gradient-text-violet">Cancel anytime.</span>
          </h1>
          <p className="text-[var(--color-ink-dim)] text-lg max-w-xl mx-auto">
            Start free. Upgrade when you&apos;re landing interviews. No long-term contracts.
          </p>
        </motion.div>
      </section>

      <PricingSection />

      {/* Full comparison table */}
      <section className="relative overflow-hidden py-24 px-4 border-t border-[var(--color-canvas-line-soft)] bg-[var(--color-canvas-deep)]">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-12"
          >
            <span className="eyebrow mb-4 inline-flex">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
              Compare plans
            </span>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-display font-semibold tracking-tight mt-4">
              Every feature, side by side.
            </h2>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="glass-card overflow-hidden"
          >
            {/* The comparison grid is wider than a phone. It scrolls inside its
                own container so the page body never scrolls horizontally. */}
            <div className="overflow-x-auto">
            {/* Column headers */}
            <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] min-w-[560px] border-b border-[var(--color-canvas-line-soft)]">
              <div className="p-4 text-xs font-mono uppercase tracking-widest text-[var(--color-ink-faint)] self-center">Feature</div>
              {PLAN_COLUMNS.map(({ name, icon: Icon, color, highlight }) => (
                <div
                  key={name}
                  className={`p-4 flex items-center justify-center gap-2 text-sm font-semibold ${highlight ? 'text-[var(--color-accent-lighter)] bg-[var(--color-accent)]/[0.06]' : 'text-[var(--color-ink-dim)]'}`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" style={{ color }} />
                  <span className="hidden sm:inline">{name}</span>
                </div>
              ))}
            </div>

            {/* Grouped rows */}
            {COMPARISON_GROUPS.map((group) => (
              <div key={group.label}>
                <div className="px-4 py-2.5 text-[11px] font-mono uppercase tracking-widest text-[var(--color-accent-lighter)] bg-[var(--color-accent)]/[0.05] border-b border-[var(--color-canvas)]">
                  {group.label}
                </div>
                {group.rows.map((row) => (
                  <div
                    key={row.feature}
                    className="grid grid-cols-[1.4fr_1fr_1fr_1fr] min-w-[560px] border-b border-[var(--color-canvas)] last:border-b-0 hover:bg-[var(--color-canvas-raise)] transition-colors"
                  >
                    <div className="p-4 text-sm text-[var(--color-ink-dim)] self-center">{row.feature}</div>
                    <div className="p-4 flex items-center justify-center"><Cell value={row.starter} /></div>
                    <div className="p-4 flex items-center justify-center bg-[var(--color-accent)]/[0.04]"><Cell value={row.pro} /></div>
                    <div className="p-4 flex items-center justify-center"><Cell value={row.enterprise} /></div>
                  </div>
                ))}
              </div>
            ))}
            </div>
          </motion.div>
        </div>
      </section>

      <FAQSection />
      <CTASection />
    </main>
  );
}
