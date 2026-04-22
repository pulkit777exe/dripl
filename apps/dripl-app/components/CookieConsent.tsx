'use client';

import { useState, useEffect } from 'react';
import { X, Cookie, Settings, Check } from 'lucide-react';

const COOKIE_CONSENT_KEY = 'dripl-cookie-consent';

interface CookieConsentState {
  accepted: boolean;
  timestamp?: number;
  preferences?: {
    necessary: boolean;
    analytics: boolean;
    marketing: boolean;
  };
}

const DEFAULT_PREFERENCES = {
  necessary: true,
  analytics: false,
  marketing: false,
};

export default function CookieConsent() {
  const [showConsent, setShowConsent] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);

  useEffect(() => {
    setIsMounted(true);
    const stored = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as CookieConsentState;
      if (parsed.preferences) {
        setPreferences(parsed.preferences);
      }
    } else {
      setShowConsent(true);
    }
  }, []);

  const handleAccept = () => {
    const consentState: CookieConsentState = {
      accepted: true,
      timestamp: Date.now(),
      preferences: { necessary: true, analytics: true, marketing: true },
    };
    localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify(consentState));
    setShowConsent(false);
  };

  const handleDismiss = () => {
    setShowConsent(false);
  };

  const handleOpenPreferences = () => {
    setShowPreferences(true);
  };

  const handleSavePreferences = () => {
    const consentState: CookieConsentState = {
      accepted: preferences.analytics || preferences.marketing,
      timestamp: Date.now(),
      preferences,
    };
    localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify(consentState));
    setShowPreferences(false);
    setShowConsent(false);
  };

  const handleTogglePreference = (key: keyof typeof preferences) => {
    if (key === 'necessary') return;
    setPreferences(prev => ({ ...prev, [key]: !prev[key] }));
  };

  if (!isMounted) {
    return null;
  }

  return (
    <>
      {showConsent && (
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
                  We use cookies to enhance your experience.{' '}
                  <button
                    onClick={handleOpenPreferences}
                    className="text-[#E8462A] hover:underline"
                  >
                    Manage preferences
                  </button>
                  .
                </p>

                <div className="mt-4 flex items-center justify-end gap-3">
                  <button
                    onClick={handleAccept}
                    className="rounded-md bg-[#E8462A] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#D6302A] transition-colors"
                    aria-label="Accept cookies"
                  >
                    Accept All
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPreferences && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => setShowPreferences(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-[#E4E0D9] bg-[#FAFAF7] p-5 shadow-lg animate-in zoom-in-95 slide-in-from-bottom-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <Settings className="size-5 text-[#E8462A]" />
                <h3 className="text-[15px] font-semibold text-[#1A1917]">Cookie Preferences</h3>
              </div>
              <button
                onClick={() => setShowPreferences(false)}
                className="rounded-md p-1 text-[#9B9890] hover:bg-[#E8E5DE] hover:text-[#6B6860] transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            <p className="mb-4 text-[13px] text-[#6B6860]">
              Manage your cookie preferences. Necessary cookies are required for the site to
              function.
            </p>

            <div className="space-y-3">
              {[
                {
                  key: 'necessary' as const,
                  label: 'Necessary',
                  description: 'Required for the website to function',
                },
                {
                  key: 'analytics' as const,
                  label: 'Analytics',
                  description: 'Help us understand how visitors interact',
                },
                {
                  key: 'marketing' as const,
                  label: 'Marketing',
                  description: 'Used to track visitors across websites',
                },
              ].map(({ key, label, description }) => (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-lg border border-[#E4E0D9] p-3"
                >
                  <div>
                    <div className="text-[13px] font-medium text-[#1A1917]">{label}</div>
                    <div className="text-[11px] text-[#9B9890]">{description}</div>
                  </div>
                  <button
                    onClick={() => handleTogglePreference(key)}
                    disabled={key === 'necessary'}
                    className={`relative h-5 w-9 rounded-full transition-colors ${
                      preferences[key] ? 'bg-[#E8462A]' : 'bg-[#D4D0C9]'
                    } ${key === 'necessary' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                        preferences[key] ? 'translate-x-0.1' : '-translate-x-4'
                      }`}
                    />
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setShowPreferences(false)}
                className="rounded-md border border-[#D4D0C9] px-4 py-2 text-[13px] font-medium text-[#6B6860] hover:bg-[#E8E5DE] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSavePreferences}
                className="rounded-md bg-[#E8462A] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#D6302A] transition-colors"
              >
                Save Preferences
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
