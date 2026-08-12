import { FloatingNav } from '@/components/FloatingNav'
import { HeroSection } from '@/components/landing/HeroSection'
import { TrustedSection } from '@/components/landing/TrustedSection'
import { FeaturesGrid } from '@/components/landing/FeaturesGrid'
import { FeatureReveal } from '@/components/landing/FeatureReveal'
import { ProductShowcase } from '@/components/landing/ProductShowcase'
import { MetricsSection } from '@/components/landing/MetricsSection'
import { TeamSection } from '@/components/landing/TeamSection'
import { TestimonialsSection } from '@/components/landing/TestimonialsSection'
import { PricingSection } from '@/components/landing/PricingSection'
import { FAQSection } from '@/components/landing/FAQSection'
import { CTASection } from '@/components/landing/CTASection'
import Footer from '@/components/Footer'

export default function Home() {
  return (
    <div className="relative min-h-screen bg-canvas">
      <FloatingNav />
      <HeroSection />
      <TrustedSection />
      <FeaturesGrid />
      <FeatureReveal />
      <ProductShowcase />
      <MetricsSection />
      <TeamSection />
      <TestimonialsSection />
      <PricingSection />
      <FAQSection />
      <CTASection />
      <Footer />
    </div>
  )
}
