import { z } from 'zod';

/**
 * Product decision Q1: a file share is a capability with a bounded life, not a
 * permanent grant. The shape matches the room share API — hours, default 24,
 * max 720 — and applies uniformly to both file-share routes.
 *
 * Before this, `POST /files/:id/share` wrote `shareExpiresAt: null` unless the
 * caller asked for an expiry, and the legacy `POST /share` had no expiry field
 * at all. A link copied once therefore stayed valid for the lifetime of the
 * row, even after the collaborator relationship that justified it ended.
 */
export const DEFAULT_SHARE_TTL_HOURS = 24;
export const MAX_SHARE_TTL_HOURS = 720;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Shared Zod fragment, spread into each route's body schema. An explicit
 * `expiresAt` wins over `expiresInHours` (existing wire behaviour); both are
 * bounded from now rather than from any caller-supplied base.
 *
 * `z.coerce.date()` maps an unparseable value to an Invalid Date, whose
 * `getTime()` is NaN, so the first refine rejects it along with past dates.
 */
export const shareExpiryFields = {
  expiresAt: z.coerce
    .date()
    .refine(value => value.getTime() > Date.now(), 'Expiry must be in the future')
    .refine(
      value => value.getTime() <= Date.now() + MAX_SHARE_TTL_HOURS * HOUR_MS,
      `Expiry must be within ${MAX_SHARE_TTL_HOURS} hours`
    )
    .optional(),
  expiresInHours: z.number().int().positive().max(MAX_SHARE_TTL_HOURS).optional(),
};

export interface ShareExpiryInput {
  expiresAt?: Date;
  expiresInHours?: number;
}

/**
 * Resolve the absolute expiry for a new share.
 *
 * The upper bound is clamped here as well as in the route schema. This helper
 * is the only place a service caller can turn "no expiry" into a date, and a
 * direct caller that bypasses the schema must not be able to mint a permanent
 * link by omission.
 */
export function resolveShareExpiry(input: ShareExpiryInput, now = Date.now()): Date {
  const requested = input.expiresAt
    ? input.expiresAt.getTime()
    : now + (input.expiresInHours ?? DEFAULT_SHARE_TTL_HOURS) * HOUR_MS;
  return new Date(Math.min(requested, now + MAX_SHARE_TTL_HOURS * HOUR_MS));
}
