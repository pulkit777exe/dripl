import { createHash } from 'node:crypto';

/**
 * SHA-256 hex of a bearer-style token before it is stored or looked up.
 *
 * Verification and password-reset tokens are `randomUUID()` (122 bits of
 * entropy), so a fast hash is the right at-rest protection: there is no
 * low-entropy input for an offline attacker to brute-force, and the point is
 * only that a database leak must not hand out live reset links. bcrypt would
 * add work factor for no entropy gain and would make every verification a
 * deliberate slow path.
 *
 * The raw token exists exactly twice — in the email link and in the request
 * that redeems it — and never in the database.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
