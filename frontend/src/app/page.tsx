import { LandingNav } from "../components/landing/LandingNav";
import { HeroSection } from "../components/landing/HeroSection";
import { TrustedSection } from "../components/landing/TrustedSection";
import { FeatureReveal } from "../components/landing/FeatureReveal";
import { MetricsSection } from "../components/landing/MetricsSection";
import { ProductShowcase } from "../components/landing/ProductShowcase";
import { TeamSection } from "../components/landing/TeamSection";
import { PricingSection } from "../components/landing/PricingSection";
import { FAQSection } from "../components/landing/FAQSection";
import { CTASection } from "../components/landing/CTASection";
import Footer from "../components/Footer";

export default function Home() {
  return (
    <div className="bg-[var(--color-canvas-deep)] min-h-screen relative selection:bg-[var(--color-accent)] selection:text-[var(--color-ink)]">
      <LandingNav />
      <HeroSection />
      <TrustedSection />
      <FeatureReveal />
      <MetricsSection />
      <ProductShowcase />
      <TeamSection />
      <PricingSection />
      <FAQSection />
      <CTASection />
      <Footer />
    </div>
  );
}
