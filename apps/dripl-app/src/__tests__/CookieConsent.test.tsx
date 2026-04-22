import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import CookieConsent from '@/components/CookieConsent';

const COOKIE_CONSENT_KEY = 'dripl-cookie-consent';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

describe('CookieConsent', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('shows consent banner when no stored consent', async () => {
    localStorageMock.getItem.mockReturnValue(null);

    await act(async () => {
      render(<CookieConsent />);
      await new Promise(r => setTimeout(r, 0));
    });

    expect(screen.getByText('Cookie Notice')).toBeInTheDocument();
  });

  it('hides consent banner when consent already given', async () => {
    localStorageMock.getItem.mockReturnValue(
      JSON.stringify({ accepted: true, timestamp: Date.now() })
    );

    await act(async () => {
      render(<CookieConsent />);
      await new Promise(r => setTimeout(r, 0));
    });

    expect(screen.queryByText('Cookie Notice')).not.toBeInTheDocument();
  });

  it('stores consent in localStorage when accept is clicked', async () => {
    localStorageMock.getItem.mockReturnValue(null);

    await act(async () => {
      render(<CookieConsent />);
      await new Promise(r => setTimeout(r, 0));
    });

    const acceptButton = screen.getByText('Accept All');
    fireEvent.click(acceptButton);

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      COOKIE_CONSENT_KEY,
      expect.stringContaining('"accepted":true')
    );
  });

  it('hides banner when dismiss is clicked without storing consent', async () => {
    localStorageMock.getItem.mockReturnValue(null);

    await act(async () => {
      render(<CookieConsent />);
      await new Promise(r => setTimeout(r, 0));
    });

    const dismissButton = screen.getByText('Manage preferences');
    fireEvent.click(dismissButton);

    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });

  it('renders cookie notice text correctly', async () => {
    localStorageMock.getItem.mockReturnValue(null);

    await act(async () => {
      render(<CookieConsent />);
      await new Promise(r => setTimeout(r, 0));
    });

    expect(screen.getByText(/We use cookies/i)).toBeInTheDocument();
  });
});
