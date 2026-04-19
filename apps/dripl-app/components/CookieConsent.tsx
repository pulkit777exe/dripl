'use client';

import { useState, useEffect } from 'react';
import { X, Cookie } from 'lucide-react';

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
      <div className="fixed bottom-5 left-5 z-50 w-full max-w-sm">
        <div className="rounded-xl border border-[#E4E0D9] bg-[#FAFAF7] p-4 shadow-lg">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#E8E5DE]">
              <Cookie className="size-5 text-[#6B6860]" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <h4 className="text-[14px] font-semibold text-[#1A1917]">Cookie Notice</h4>
                <button
                  onClick={handleDismiss}
                  className="rounded-md p-1 text-[#9B9890] hover:bg-[#E8E5DE] hover:text-[#6B6860] transition-colors"
                  aria-label="Dismiss cookie notice"
                >
                  <X size={14} />
                </button>
              </div>

              <p className="mt-2 text-[13px] leading-relaxed text-[#6B6860]">
                We use cookies to ensure the best experience on our website.{' '}
                <a href="#" className="text-[#E8462A] hover:underline">
                  Read cookie policies
                </a>
                .
              </p>

              <div className="mt-4 flex items-center justify-between gap-3">
                <button
                  onClick={handleDismiss}
                  className="text-[12px] text-[#6B6860] hover:text-[#1A1917] underline underline-offset-2 transition-colors"
                  aria-label="Manage cookie preferences"
                >
                  Manage preferences
                </button>
                <button
                  onClick={handleAccept}
                  className="rounded-md bg-[#E8462A] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#D6302A] transition-colors"
                  aria-label="Accept cookies"
                >
                  Accept
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="h-60"></div>
    </>
  );
}
