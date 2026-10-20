import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHARE_TTL_HOURS,
  MAX_SHARE_TTL_HOURS,
  resolveShareExpiry,
} from '../../lib/shareExpiry';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');
const HOUR = 60 * 60 * 1000;

describe('resolveShareExpiry', () => {
  it('defaults a share with no expiry input to 24 hours', () => {
    expect(resolveShareExpiry({}, NOW).getTime()).toBe(NOW + DEFAULT_SHARE_TTL_HOURS * HOUR);
  });

  it('uses expiresInHours when given', () => {
    expect(resolveShareExpiry({ expiresInHours: 2 }, NOW).getTime()).toBe(NOW + 2 * HOUR);
  });

  it('lets an explicit expiresAt win over expiresInHours', () => {
    const explicit = new Date(NOW + 3 * HOUR);
    expect(resolveShareExpiry({ expiresAt: explicit, expiresInHours: 12 }, NOW).getTime()).toBe(
      explicit.getTime()
    );
  });

  it('clamps an hours value above the 30-day cap', () => {
    expect(resolveShareExpiry({ expiresInHours: 10_000 }, NOW).getTime()).toBe(
      NOW + MAX_SHARE_TTL_HOURS * HOUR
    );
  });

  it('clamps an explicit expiry above the cap', () => {
    const tooFar = new Date(NOW + (MAX_SHARE_TTL_HOURS + 24) * HOUR);
    expect(resolveShareExpiry({ expiresAt: tooFar }, NOW).getTime()).toBe(
      NOW + MAX_SHARE_TTL_HOURS * HOUR
    );
  });

  it('keeps an expiry exactly at the cap', () => {
    const cap = new Date(NOW + MAX_SHARE_TTL_HOURS * HOUR);
    expect(resolveShareExpiry({ expiresAt: cap }, NOW).getTime()).toBe(cap.getTime());
  });
});
