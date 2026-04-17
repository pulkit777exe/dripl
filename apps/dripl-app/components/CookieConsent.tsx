'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

const COOKIE_CONSENT_KEY = 'dripl-cookie-consent';

interface CookieConsentState {
  accepted: boolean;
  timestamp?: number;
}

export default function CookieConsent() {
  const [showConsent, setShowConsent] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    const stored = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (!stored) {
      setShowConsent(true);
    }
  }, []);

  const handleAccept = () => {
    const consentState: CookieConsentState = {
      accepted: true,
      timestamp: Date.now(),
    };
    localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify(consentState));
    setShowConsent(false);
  };

  const handleDismiss = () => {
    setShowConsent(false);
  };

  if (!isMounted || !showConsent) {
    return null;
  }

  return (
    <>
      <div className="bg-background fixed bottom-5 left-5 mx-auto max-w-md rounded-2xl border p-4 shadow-lg z-50">
        <button
          onClick={handleDismiss}
          className="absolute top-2 right-2 p-1 hover:bg-muted rounded-md transition-colors"
          aria-label="Dismiss cookie notice"
        >
          <X size={16} className="text-muted-foreground" />
        </button>
        
        <h4 className="font-semibold text-foreground">Cookie Notice</h4>

        <p className="text-muted-foreground mt-2 text-sm">
          We use cookies to ensure that we give you the best experience on our website.{" "}
          <a href="#" className="text-blue-500 hover:underline">
            Read cookies policies
          </a>
          .
        </p>

        <div className="mt-4 flex shrink-0 items-center justify-between gap-x-4">
          <button
            onClick={handleDismiss}
            className="text-xs text-muted-foreground hover:text-foreground underline"
            aria-label="Manage cookie preferences"
          >
            Manage your preferences
          </button>
          <button
            onClick={handleAccept}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:opacity-90 transition-opacity"
            aria-label="Accept cookies"
          >
            Accept
          </button>
        </div>
      </div>

      <div className="h-60"></div>
    </>
  );
}