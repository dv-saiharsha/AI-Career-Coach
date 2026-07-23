import type { Metadata } from 'next';
import { FeaturesPageClient } from './FeaturesPageClient';
import { LandingNav } from '../../components/landing/LandingNav';
import Footer from '../../components/Footer';

export const metadata: Metadata = {
  title: 'Features — Zenith',
  description: 'Complete feature breakdown of the AI Resume Analyzer and AI Interview Coach.',
};

export default function FeaturesPage() {
  return (
    <div className="bg-[var(--color-canvas-deep)] min-h-screen selection:bg-[var(--color-accent)] selection:text-[var(--color-ink)]">
      <LandingNav />
      <FeaturesPageClient />
      <Footer />
    </div>
  );
}
