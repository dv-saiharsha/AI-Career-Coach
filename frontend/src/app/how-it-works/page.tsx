import type { Metadata } from 'next';
import { HowItWorksClient } from './HowItWorksClient';
import { FloatingNav } from '@/components/FloatingNav';
import Footer from '../../components/Footer';

export const metadata: Metadata = {
  title: 'How It Works — Zenith',
  description: 'A step-by-step walkthrough of the Zenith workflow.',
};

export default function HowItWorksPage() {
  return (
    <div className="bg-[var(--color-canvas-deep)] min-h-screen">
      <FloatingNav />
      <HowItWorksClient />
      <Footer />
    </div>
  );
}
