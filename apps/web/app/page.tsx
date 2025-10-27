"use client";

import { useAuthStore, useUIStore } from "@repo/store";
import AuthModal from "../components/auth/AuthModal";
import AuthenticatedLanding from "../components/landing/AuthenticatedLanding";
import PublicLanding from "../components/landing/PublicLanding";


export default function Home() {
  const { isAuthenticated } = useAuthStore();
  const { showAuthModal, setShowAuthModal } = useUIStore();

  return (
    <>
      {isAuthenticated ? (
        <AuthenticatedLanding onShowAuthModal={() => setShowAuthModal(true)} />
      ) : (
        <PublicLanding onShowAuthModal={() => setShowAuthModal(true)} />
      )}
      
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        defaultMode="signup"
      />
    </>
  );
}