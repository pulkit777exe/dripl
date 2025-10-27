"use client";

import { useState } from "react";
import { Modal } from "@repo/ui";
import { useUIStore } from "@repo/store";
import SignInForm from "./SignInForm";
import SignUpForm from "./SignUpForm";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultMode?: "signin" | "signup";
  onSuccess?: () => void;
}

export default function AuthModal({ isOpen, onClose, defaultMode = "signin", onSuccess }: AuthModalProps) {
  const [mode, setMode] = useState<"signin" | "signup">(defaultMode);
  const { clearError } = useUIStore();

  const handleClose = () => {
    clearError();
    onClose();
  };

  const handleSuccess = () => {
    onSuccess?.();
    handleClose();
  };

  const switchToSignUp = () => {
    setMode("signup");
    clearError();
  };

  const switchToSignIn = () => {
    setMode("signin");
    clearError();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={mode === "signup" ? "Create Account" : "Sign In"}
    >
      {mode === "signin" ? (
        <SignInForm 
          onSuccess={handleSuccess}
          onSwitchToSignUp={switchToSignUp}
        />
      ) : (
        <SignUpForm 
          onSuccess={handleSuccess}
          onSwitchToSignIn={switchToSignIn}
        />
      )}
    </Modal>
  );
}
