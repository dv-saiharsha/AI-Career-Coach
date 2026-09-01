import type { Metadata } from 'next';
import { HowItWorksClient } from './HowItWorksClient';
import { SiteNav } from '@/components/landing/SiteNav';
import Footer from '../../components/Footer';

export const metadata: Metadata = {
  title: 'How It Works — ApplyCenter',
  description: 'A step-by-step walkthrough of the ApplyCenter workflow.',
};

export default function HowItWorksPage() {
  return (
    <div className="bg-[var(--color-canvas-deep)] min-h-screen">
      <SiteNav />
      <HowItWorksClient />
      <Footer />
    </div>
  );
}
