import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  trackEvent,
  trackCanvasEvent,
  trackAuthEvent,
  getAnalyticsConsent,
  resetAnalyticsConsent,
} from '@/utils/analytics';

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

describe('analytics', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log');
  });

  describe('trackEvent', () => {
    it('does not log when no consent stored', () => {
      localStorageMock.getItem.mockReturnValue(null);
      trackEvent('canvas', 'test-action');
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('does not log when consent is false', () => {
      localStorageMock.getItem.mockReturnValue(
        JSON.stringify({ accepted: false })
      );
      trackEvent('canvas', 'test-action');
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('does not log when consent is corrupted', () => {
      localStorageMock.getItem.mockReturnValue('invalid-json');
      trackEvent('canvas', 'test-action');
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('logs event when consent is true', () => {
      localStorageMock.getItem.mockReturnValue(
        JSON.stringify({ accepted: true, timestamp: Date.now() })
      );
      trackEvent('canvas', 'element-created', { label: 'rectangle' });
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('"type":"analytics"')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('"category":"canvas"')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('"action":"element-created"')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('"label":"rectangle"')
      );
    });

    it('logs event with optional value', () => {
      localStorageMock.getItem.mockReturnValue(
        JSON.stringify({ accepted: true, timestamp: Date.now() })
      );
      trackEvent('export', 'export-png', { value: 2 });
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('"value":2')
      );
    });
  });

  describe('trackCanvasEvent', () => {
    it('delegates to trackEvent with canvas category', () => {
      localStorageMock.getItem.mockReturnValue(
        JSON.stringify({ accepted: true, timestamp: Date.now() })
      );
      trackCanvasEvent('element-created', { label: 'rectangle' });
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('"category":"canvas"')
      );
    });
  });

  describe('trackAuthEvent', () => {
    it('delegates to trackEvent with auth category', () => {
      localStorageMock.getItem.mockReturnValue(
        JSON.stringify({ accepted: true, timestamp: Date.now() })
      );
      trackAuthEvent('login-success');
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('"category":"auth"')
      );
    });
  });

  describe('getAnalyticsConsent', () => {
    it('returns false when no consent', () => {
      localStorageMock.getItem.mockReturnValue(null);
      expect(getAnalyticsConsent()).toBe(false);
    });

    it('returns true when consent accepted', () => {
      localStorageMock.getItem.mockReturnValue(
        JSON.stringify({ accepted: true, timestamp: Date.now() })
      );
      expect(getAnalyticsConsent()).toBe(true);
    });

    it('returns false when consent rejected', () => {
      localStorageMock.getItem.mockReturnValue(
        JSON.stringify({ accepted: false, timestamp: Date.now() })
      );
      expect(getAnalyticsConsent()).toBe(false);
    });
  });

  describe('resetAnalyticsConsent', () => {
    it('removes consent from localStorage', () => {
      resetAnalyticsConsent();
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(COOKIE_CONSENT_KEY);
    });
  });
});