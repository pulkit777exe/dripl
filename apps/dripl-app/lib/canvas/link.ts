/**
 * Link input normalization — pure helper for the TransformationPanel link
 * editor. Trims, drops no-op edits, clears on empty input, and prepends
 * `https://` to bare domains so pasted `example.com` just works. Unsafe
 * schemes are still stored (collaborators may fix them) but never opened
 * or exported — see `isSafeHttpUrl`.
 */

export interface NormalizedLink {
  changed: boolean;
  value: string | undefined;
}

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export function normalizeLinkInput(raw: string, committed: string): NormalizedLink {
  const trimmed = raw.trim();
  if (trimmed === committed) return { changed: false, value: undefined };
  if (trimmed === '') return { changed: true, value: undefined };
  return {
    changed: true,
    value: SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`,
  };
}
