"use client";

import {
  Button,
  Badge,
  Card,
  CardContent,
  Section,
  SectionContainer,
  SectionHeader,
  SectionTitle,
  SectionDescription,
  Layout,
  LayoutContainer,
  LayoutGrid,
  FeatureCard,
  Background,
} from "@repo/ui";
import NavBar from "../layout/NavBar";
import {
  Plus, 
  LogIn, 
  ArrowRight,
  Palette,
  MessageSquare,
  Zap,
  Sparkles
} from "lucide-react";

interface PublicLandingProps {
  onShowAuthModal: () => void;
}

export default function PublicLanding({ onShowAuthModal }: PublicLandingProps) {
  return (
    <Background variant="animated">
      <NavBar />
      
      <Section variant="hero" background="default" padding="xl">
        <SectionContainer>
          <SectionHeader>
            <Badge variant="announcement" size="md">
              <Sparkles style={{ width: "1rem", height: "1rem" }} />
              Real-time Collaboration
            </Badge>
            
            <SectionTitle>Draw, Chat, Create Together</SectionTitle>
            <SectionDescription>
              Collaborative drawing canvas with real-time chat. Join rooms instantly and create together.
            </SectionDescription>
          </SectionHeader>

          <LayoutContainer maxWidth="md">
            <Layout variant="default" spacing="lg">
              {/* Main Action Card */}
              <Card variant="glass">
                <CardContent padding="lg">
                  <Layout variant="default" spacing="lg">
                    <FeatureCard
                      icon={<Plus style={{ width: "1.5rem", height: "1.5rem", color: "var(--content-inverted)" }} />}
                      title="Create New Room"
                      description="Start fresh with a random room ID"
                      onClick={onShowAuthModal}
                    />

                    <FeatureCard
                      icon={<LogIn style={{ width: "1.5rem", height: "1.5rem", color: "var(--content-inverted)" }} />}
                      title="Join Existing Room"
                      description="Have a room ID? Jump right in"
                      onClick={onShowAuthModal}
                    />

                    <Button
                      onClick={onShowAuthModal}
                      variant="primary"
                      size="lg"
                      style={{ width: "100%" }}
                    >
                      Get Started <ArrowRight style={{ width: "1.25rem", height: "1.25rem", marginLeft: "0.5rem" }} />
                    </Button>
                  </Layout>
                </CardContent>
              </Card>
            </Layout>
          </LayoutContainer>

          {/* Feature Grid */}
          <LayoutContainer maxWidth="lg" style={{ marginTop: "4rem" }}>
            <LayoutGrid columns={3} gap="lg" minColumnWidth="250px">
              <FeatureCard
                icon={<Palette style={{ width: "1.5rem", height: "1.5rem", color: "var(--content-inverted)" }} />}
                title="Draw Together"
                description="Real-time collaborative canvas with multiple tools"
                hover={false}
                variant="glass"
              />
              <FeatureCard
                icon={<MessageSquare style={{ width: "1.5rem", height: "1.5rem", color: "var(--content-inverted)" }} />}
                title="Team Chat"
                description="Communicate while you create with built-in chat"
                hover={false}
                variant="glass"
              />
              <FeatureCard
                icon={<Zap style={{ width: "1.5rem", height: "1.5rem", color: "var(--content-inverted)" }} />}
                title="Instant Rooms"
                description="No setup required, start collaborating immediately"
                hover={false}
                variant="glass"
              />
            </LayoutGrid>
          </LayoutContainer>
        </SectionContainer>
      </Section>
    </Background>
  );
}