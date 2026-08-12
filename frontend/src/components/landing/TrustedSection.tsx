'use client'

import { Marquee, MarqueeFade } from '@/components/ui/marquee'

const COMPANIES = [
  'Google',
  'Meta',
  'Amazon',
  'Microsoft',
  'Apple',
  'Netflix',
  'Stripe',
  'Figma',
  'Notion',
  'Linear',
  'Vercel',
  'OpenAI',
]

export function TrustedSection() {
  return (
    <section className="relative overflow-hidden border-t border-canvas-line py-16">
      <p className="shell mb-9 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-ink-faint">
        Trusted by candidates at top companies
      </p>

      <div className="relative">
        <MarqueeFade side="left" />
        <Marquee duration={48} pauseOnHover gap="3.5rem">
          {COMPANIES.map((company) => (
            <span
              key={company}
              className="shrink-0 select-none font-display text-xl tracking-[-0.02em] text-ink-faint transition-colors duration-300 hover:text-ink"
            >
              {company}
            </span>
          ))}
        </Marquee>
        <MarqueeFade side="right" />
      </div>
    </section>
  )
}
