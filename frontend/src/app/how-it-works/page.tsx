import type { Metadata } from 'next';
import { HowItWorksClient } from './HowItWorksClient';
import { LandingNav } from '../../components/landing/LandingNav';
import Footer from '../../components/Footer';

export const metadata: Metadata = {
  title: 'How It Works — AI Career Coach',
  description: 'A step-by-step walkthrough of the AI Career Coach workflow.',
};

export default function HowItWorksPage() {
  return (
    <div className="bg-[var(--color-canvas-deep)] min-h-screen selection:bg-[var(--color-accent)] selection:text-[var(--color-ink)]">
      <LandingNav />
      <HowItWorksClient />
      <Footer />
    </div>
  );
}
