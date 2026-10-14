import { createHash } from 'node:crypto';
import { DriplElementSchema, MAX_SCENE_ELEMENTS } from '@dripl/common';

export function isValidSceneContent(content: unknown): boolean {
  const candidate = Array.isArray(content)
    ? content
    : content && typeof content === 'object' && 'elements' in content
      ? (content as { elements?: unknown }).elements
      : null;
  if (!Array.isArray(candidate) || candidate.length > MAX_SCENE_ELEMENTS) return false;
  return candidate.every(element => DriplElementSchema.safeParse(element).success);
}

/**
 * Memoized string-form scene validation for the save path.
 *
 * Every file/room save re-runs up to 5,000 Zod parses (~7 ms at 5k elements,
 * measured 2026-10-14), yet periodic saves and consecutive operations on one
 * scene routinely re-validate byte-identical content. This memo makes the
 * repeat case a hash + map lookup (~2 ms of sha256 at 1 MB) with identical
 * true/false answers: the key is the full content bytes, so a hit can only
 * repeat the verdict the same bytes earned before.
 *
 * sha256 rather than a fast non-crypto hash is deliberate: validation enforces
 * the element-count and field-bound caps, so it is a trust boundary, and
 * collisions in FNV/djb2 are cheap to manufacture. The map holds hashes and
 * booleans only — never content — and is bounded, so memory is ~50 × 64 bytes.
 */
const SCENE_VALIDATION_MEMO_LIMIT = 50;

const sceneValidationMemo = new Map<string, boolean>();

export function isValidSceneString(content: string): boolean {
  const key = createHash('sha256').update(content, 'utf8').digest('hex');
  const cached = sceneValidationMemo.get(key);
  if (cached !== undefined) {
    // Refresh recency: delete + re-insert moves the key to the newest end.
    sceneValidationMemo.delete(key);
    sceneValidationMemo.set(key, cached);
    return cached;
  }
  let valid: boolean;
  try {
    valid = isValidSceneContent(JSON.parse(content));
  } catch {
    valid = false;
  }
  sceneValidationMemo.set(key, valid);
  if (sceneValidationMemo.size > SCENE_VALIDATION_MEMO_LIMIT) {
    const oldest = sceneValidationMemo.keys().next().value;
    if (oldest !== undefined) sceneValidationMemo.delete(oldest);
  }
  return valid;
}
