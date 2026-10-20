import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison for the places this repo compares an
 * attacker-supplied value against a trusted one: the CSRF double-submit pair,
 * the OAuth `state` against its cookie, and the internal service secret.
 *
 * The `length !== length` pre-check is not a secret leak: `timingSafeEqual`
 * throws on unequal lengths, so the guard is required, and the length of the
 * expected value is fixed at every call site anyway (a 32-byte CSRF token, a
 * `randomUUID()` state, the configured `INTERNAL_SECRET`). What this function
 * does equalize is the byte-by-byte comparison itself, where `===` would
 * short-circuit on the first differing byte and let a remote caller walk the
 * correct value one prefix at a time.
 */
export function timingSafeEqualString(expected: string, provided: string): boolean {
  if (expected.length !== provided.length) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
