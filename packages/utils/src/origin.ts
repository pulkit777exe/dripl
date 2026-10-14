/**
 * The single origin normalizer for every HTTP boundary in this repo.
 *
 * Previously `apps/http-server/src/app.ts` (CORS allowlist),
 * `apps/dripl-app/lib/server/origin.ts` (BFF origin policy) and
 * `apps/dripl-app/app/api/share/route.ts` (`configuredAppOrigin`) each
 * hand-rolled the same three lines: parse with `new URL`, accept only
 * `http:`/`https:`, return `.origin`. Three copies cannot drift in three
 * different directions, so this module owns the grammar and the call sites
 * own only where their allowlist comes from.
 *
 * Contract, pinned by `origin.test.ts`:
 * - falsy input, an unparseable URL, or a non-HTTP(S) scheme reads as `null`
 *   (never the string `'null'`, never the input echoed back).
 * - `parseAllowedOrigins` splits comma-separated env values, trims entries,
 *   and drops anything `normalizeOrigin` rejects, so a typo in
 *   `FRONTEND_URL` narrows the allowlist rather than widening it.
 */
export function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Build an allowlist from raw env values such as `FRONTEND_URL` (which may
 * hold a comma-separated list). Entries that do not normalize are dropped.
 */
export function parseAllowedOrigins(values: Array<string | undefined>): string[] {
  return values
    .flatMap(value => value?.split(',') ?? [])
    .map(entry => normalizeOrigin(entry.trim()))
    .filter((value): value is string => value !== null);
}
