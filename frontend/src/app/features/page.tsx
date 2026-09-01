import type { Metadata } from 'next';
import { FeaturesPageClient } from './FeaturesPageClient';
import { SiteNav } from '@/components/landing/SiteNav';
import Footer from '../../components/Footer';

export const metadata: Metadata = {
  title: 'Features — ApplyCenter',
  description: 'Complete feature breakdown of the AI Resume Analyzer and AI Interview Coach.',
};

export default function FeaturesPage() {
  return (
    <div className="bg-[var(--color-canvas-deep)] min-h-screen">
      <SiteNav />
      <FeaturesPageClient />
      <Footer />
    </div>
  );
}
