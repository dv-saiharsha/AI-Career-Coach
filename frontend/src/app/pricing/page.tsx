import type { Metadata } from 'next';
import { PricingPageClient } from './PricingPageClient';
import { LandingNav } from '../../components/landing/LandingNav';
import Footer from '../../components/Footer';

export const metadata: Metadata = {
  title: 'Pricing — AI Career Coach',
  description: 'Simple, transparent pricing for AI Resume Analyzer and Interview Coach.',
};

export default function PricingPage() {
  return (
    <div className="bg-[var(--color-canvas-deep)] min-h-screen selection:bg-[var(--color-accent)] selection:text-[var(--color-ink)]">
      <LandingNav />
      <PricingPageClient />
      <Footer />
    </div>
  );
}
