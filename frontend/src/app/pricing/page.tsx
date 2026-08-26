import type { Metadata } from 'next';
import { PricingPageClient } from './PricingPageClient';
import { FloatingNav } from '@/components/FloatingNav';
import Footer from '../../components/Footer';

export const metadata: Metadata = {
  title: 'Pricing — ApplyCenter',
  description: 'Simple, transparent pricing for AI Resume Analyzer and Interview Coach.',
};

export default function PricingPage() {
  return (
    <div className="bg-[var(--color-canvas-deep)] min-h-screen">
      <FloatingNav />
      <PricingPageClient />
      <Footer />
    </div>
  );
}
