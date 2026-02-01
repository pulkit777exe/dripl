"use client";

import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { HeroSection } from "@/components/marketing/sections/HeroSection";
import { BentoGrid } from "@/components/marketing/sections/BentoGrid";
import { IntegrationCarousel } from "@/components/marketing/sections/IntegrationCarousel";
import { WorkflowSection } from "@/components/marketing/sections/WorkflowSection";
import { TestimonialCarousel } from "@/components/marketing/sections/TestimonialCarousel";
import { PricingTable } from "@/components/marketing/sections/PricingTable";
import { useAuth } from "./context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Page() {
  const { user, loading, token, generateToken } = useAuth();
  const router = useRouter();

  // Handle authentication flow
  useEffect(() => {
    if (!loading) {
      if (token && !user) {
        // Anonymous user with token - redirect to remote canvas
        const lastCanvas = localStorage.getItem("dripl_last_canvas");
        if (lastCanvas) {
          router.push(`/canvas/${lastCanvas}`);
        } else {
          // Create a new canvas room
          const newRoomSlug = crypto.randomUUID();
          localStorage.setItem("dripl_last_canvas", newRoomSlug);
          router.push(`/canvas/${newRoomSlug}`);
        }
      } else if (user) {
        // Authenticated user - redirect to dashboard
        router.push("/dashboard");
      }
      // If neither user nor token, stay on landing page
    }
  }, [user, token, loading, router]);

  const handleStartDrawing = async () => {
    try {
      if (!token) {
        // Generate token for anonymous user
        await generateToken();
      }
      
      // Create new canvas or navigate to existing one
      const lastCanvas = localStorage.getItem("dripl_last_canvas");
      if (lastCanvas) {
        router.push(`/canvas/${lastCanvas}`);
      } else {
        const newRoomSlug = crypto.randomUUID();
        localStorage.setItem("dripl_last_canvas", newRoomSlug);
        router.push(`/canvas/${newRoomSlug}`);
      }
    } catch (error) {
      console.error("Failed to start drawing:", error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <MarketingLayout>
      <HeroSection onStartDrawing={handleStartDrawing} />
      <BentoGrid />
      <IntegrationCarousel />
      <WorkflowSection />
      <TestimonialCarousel />
      <PricingTable />
    </MarketingLayout>
  );
}
