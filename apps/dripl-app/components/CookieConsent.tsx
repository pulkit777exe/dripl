'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Cookie, Settings } from 'lucide-react';

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

  const [animState, setAnimState] = useState<'closed' | 'opening' | 'open' | 'closing'>('closed');
  const prevOpen = useRef(false);

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

  useEffect(() => {
    if (showPreferences && !prevOpen.current) {
      prevOpen.current = true;
      setAnimState('opening');
    }
  }, [showPreferences]);

  useEffect(() => {
    if (animState === 'opening') {
      const raf = requestAnimationFrame(() => setAnimState('open'));
      return () => cancelAnimationFrame(raf);
    }
    if (animState === 'closing') {
      const ms = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--modal-close-dur')
      ) || 150;
      const timer = setTimeout(() => {
        setAnimState('closed');
        setShowPreferences(false);
      }, ms);
      return () => clearTimeout(timer);
    }
  }, [animState]);

  if (!isMounted) return null;

  const modalState = animState === 'open' ? 'is-open' : animState === 'closing' ? 'is-closing' : '';

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

  const handleClosePreferences = () => {
    setAnimState('closing');
  };

  const handleSavePreferences = () => {
    const consentState: CookieConsentState = {
      accepted: preferences.analytics || preferences.marketing,
      timestamp: Date.now(),
      preferences,
    };
    localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify(consentState));
    setShowConsent(false);
    setAnimState('closing');
  };

  const handleTogglePreference = (key: keyof typeof preferences) => {
    if (key === 'necessary') return;
    setPreferences(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const preferencesModal = animState !== 'closed' ? (
    <div
      className={`fixed inset-0 z-400 flex items-center justify-center p-4 box-content backdrop-blur-sm pointer-events-auto t-modal ${modalState}`}
      style={{ backgroundColor: 'rgba(26, 25, 23, 0.6)' }}
      onClick={handleClosePreferences}
    >
      <div
        className="w-full max-w-md rounded-xl shadow-lg p-5 max-h-[85vh] overflow-y-auto"
        style={{ backgroundColor: '#FAFAF7', border: '1px solid #E4E0D9' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Settings className="size-5" style={{ color: '#E8462A' }} />
            <h3 className="text-[15px] font-semibold" style={{ color: '#1A1917' }}>Cookie Preferences</h3>
          </div>
          <button
            onClick={handleClosePreferences}
            className="p-1 rounded-md transition-colors"
            style={{ color: '#6B6860' }}
          >
            <X size={14} />
          </button>
        </div>

        <p className="mb-4 text-[13px]" style={{ color: '#6B6860' }}>
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
              className="flex items-center justify-between rounded-lg p-3"
              style={{ border: '1px solid #E4E0D9' }}
            >
              <div>
                <div className="text-[13px] font-medium" style={{ color: '#1A1917' }}>{label}</div>
                <div className="text-[11px]" style={{ color: '#6B6860' }}>{description}</div>
              </div>
              <button
                onClick={() => handleTogglePreference(key)}
                disabled={key === 'necessary'}
                className="relative h-5 w-9 rounded-full transition-colors"
                style={{
                  backgroundColor: preferences[key] ? '#E8462A' : '#EAE6DE',
                  opacity: key === 'necessary' ? 0.5 : 1,
                  cursor: key === 'necessary' ? 'not-allowed' : 'pointer'
                }}
              >
                <span
                  className="absolute top-0.5 h-4 w-4 rounded-full shadow transition-transform"
                  style={{
                    backgroundColor: '#FAFAF7',
                    transform: preferences[key] ? 'translateX(18px)' : 'translateX(2px)'
                  }}
                />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button
            onClick={handleClosePreferences}
            className="px-3 py-1.5 text-[13px] transition-colors"
            style={{ color: '#6B6860' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSavePreferences}
            className="px-4 py-2 text-[13px] font-medium rounded-md transition-colors"
            style={{ backgroundColor: '#E8462A', color: '#FAFAF7' }}
          >
            Save Preferences
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      {showConsent && (
        <div className="fixed bottom-5 left-5 z-400 w-full max-w-sm">
          <div className="rounded-xl shadow-lg p-4 backdrop-blur-sm" style={{ border: '1px solid #E4E0D9', backgroundColor: '#FAFAF7' }}>
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: '#EAE6DE' }}>
                <Cookie className="size-5" style={{ color: '#E8462A' }} />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h4 className="text-[14px] font-semibold" style={{ color: '#1A1917' }}>Cookie Notice</h4>
                  <button
                    onClick={handleDismiss}
                    className="rounded-md p-1 transition-colors"
                    style={{ color: '#6B6860' }}
                    aria-label="Dismiss cookie notice"
                  >
                    <X size={14} />
                  </button>
                </div>

                <p className="mt-2 text-[13px] leading-relaxed" style={{ color: '#6B6860' }}>
                  We use cookies to enhance your experience.{' '}
                  <button
                    onClick={handleOpenPreferences}
                    className="font-medium hover:underline"
                    style={{ color: '#E8462A' }}
                  >
                    Manage preferences
                  </button>
                  .
                </p>

                <div className="mt-4 flex items-center justify-end gap-3">
                  <button
                    onClick={handleAccept}
                    className="rounded-lg px-4 py-2 text-[13px] font-medium transition-colors"
                    style={{ backgroundColor: '#E8462A', color: '#FAFAF7' }}
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

      {preferencesModal && createPortal(preferencesModal, document.body)}
    </>
  );
}
