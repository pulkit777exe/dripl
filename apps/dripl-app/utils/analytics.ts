const ANALYTICS_KEY = 'dripl-analytics-enabled';

type EventCategory =
  | 'canvas'
  | 'actions'
  | 'auth'
  | 'export'
  | 'navigation'
  | 'collaboration'
  | 'ui';

interface AnalyticsEvent {
  category: EventCategory;
  action: string;
  label?: string;
  value?: number;
  timestamp: number;
  userAgent?: string;
  url?: string;
}

function isAnalyticsEnabled(): boolean {
  if (typeof window === 'undefined') return false;

  const consent = localStorage.getItem('dripl-cookie-consent');
  if (!consent) return false;

  try {
    const parsed = JSON.parse(consent);
    return parsed.accepted === true;
  } catch {
    return false;
  }
}

export function trackEvent(
  category: EventCategory,
  action: string,
  options?: {
    label?: string;
    value?: number;
  }
): void {
  if (!isAnalyticsEnabled()) {
    return;
  }

  const event: AnalyticsEvent = {
    category,
    action,
    label: options?.label,
    value: options?.value,
    timestamp: Date.now(),
    url: typeof window !== 'undefined' ? window.location.href : undefined,
  };

  console.log(
    JSON.stringify({
      type: 'analytics',
      ...event,
    })
  );
}

export function trackCanvasEvent(
  action: string,
  options?: { label?: string; value?: number }
): void {
  trackEvent('canvas', action, options);
}

export function trackAuthEvent(action: string, options?: { label?: string; value?: number }): void {
  trackEvent('auth', action, options);
}

export function trackExportEvent(
  action: string,
  options?: { label?: string; value?: number }
): void {
  trackEvent('export', action, options);
}

export function trackNavigationEvent(
  action: string,
  options?: { label?: string; value?: number }
): void {
  trackEvent('navigation', action, options);
}

export function trackCollaborationEvent(
  action: string,
  options?: { label?: string; value?: number }
): void {
  trackEvent('collaboration', action, options);
}

export function trackUIAction(action: string, options?: { label?: string; value?: number }): void {
  trackEvent('ui', action, options);
}

export function getAnalyticsConsent(): boolean {
  return isAnalyticsEnabled();
}

export function resetAnalyticsConsent(): void {
  localStorage.removeItem('dripl-cookie-consent');
}
