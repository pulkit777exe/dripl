import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { HeroSection } from "@/components/marketing/sections/HeroSection";
import { BentoGrid } from "@/components/marketing/sections/BentoGrid";
import { IntegrationCarousel } from "@/components/marketing/sections/IntegrationCarousel";
import { WorkflowSection } from "@/components/marketing/sections/WorkflowSection";
import { TestimonialCarousel } from "@/components/marketing/sections/TestimonialCarousel";
import { PricingTable } from "@/components/marketing/sections/PricingTable";

export default function Page() {
  return (
    <MarketingLayout>
      <HeroSection />
      <BentoGrid />
      <IntegrationCarousel />
      <WorkflowSection />
      <TestimonialCarousel />
      <PricingTable />
    </MarketingLayout>
  );
}
