import { CanvasContentSchema, MAX_SCENE_ELEMENTS, type DriplElement } from '@dripl/common';
import { isJsonRecord, normalizeImportedElement } from './normalize';

/**
 * Native `.dripl` scene document — the single definition of the format.
 *
 * Both "Save to file" in the TopBar and the export modal's `dripl` format
 * call this writer, so the saved and the exported document cannot drift.
 * The open path (`useTopBarFileOps.handleOpenFile`) validates
 * `document.elements` with `CanvasContentSchema`; the writer therefore emits
 * elements verbatim instead of projecting them through a field filter. There
 * is no foreign schema to satisfy, so there is no omission list to keep
 * current — a newly added element field is carried by the export for free.
 *
 * `parseDriplDocument` below is the other half of the definition: a format
 * whose reader is a separate implementation of the writer's contract is a
 * format with two sources of truth, which is how the open path and the
 * import path came to disagree about whether a file was valid.
 */

export const DRIPL_SCENE_TYPE = 'dripl-scene';
export const DRIPL_SCENE_VERSION = 1;

/** Hard ceiling on elements read from a document, matching the scene limit. */
export const MAX_IMPORT_ELEMENTS = MAX_SCENE_ELEMENTS;

/**
 * Hard ceiling on document bytes, applied before `JSON.parse`.
 *
 * Counted as real UTF-8 bytes via `TextEncoder`, not as
 * `String.prototype.length`. `length` is UTF-16 code units, so it undercounts
 * every multi-byte character: a document of astral-plane emoji measures half
 * its true size, and a constant named `..._BYTES` that silently admits twice
 * the payload it promises is a trap for the next caller who reuses it as an
 * upload limit. UTF-8 is the right unit here because a `.dripl` file is a
 * UTF-8 JSON document on disk, so bytes are what its size on disk is.
 *
 * Encoding is UTF-8 in both jsdom and Node (WHATWG), so this is the same
 * number `file.size` would report for the file the user picked — and matches
 * `MAX_SNAPSHOT_BYTES` in `app/api/canvas/snapshots/route.ts`, which measures
 * the same way for the same reason.
 */
export const MAX_IMPORT_BYTES = 5_000_000;

export interface DriplSceneDocument {
  version: typeof DRIPL_SCENE_VERSION;
  type: typeof DRIPL_SCENE_TYPE;
  exportedAt: number;
  elements: DriplElement[];
  appState: Record<string, unknown>;
}

/**
 * Build the `.dripl` document. Key order matches the bytes the file has
 * always carried on disk; `exportedAt` is injectable so callers (and tests)
 * can pin it.
 */
export function buildDriplSceneDocument(
  elements: readonly DriplElement[],
  appState: Record<string, unknown> = {},
  exportedAt: number = Date.now()
): DriplSceneDocument {
  return {
    version: DRIPL_SCENE_VERSION,
    type: DRIPL_SCENE_TYPE,
    exportedAt,
    elements: [...elements],
    appState: { ...appState },
  };
}

/** Serialize a scene as a downloadable `.dripl` blob. */
export function exportToDripl(
  elements: readonly DriplElement[],
  appState: Record<string, unknown> = {},
  exportedAt?: number
): Blob {
  const document = buildDriplSceneDocument(elements, appState, exportedAt);
  return new Blob([JSON.stringify(document, null, 2)], {
    type: 'application/json',
  });
}

/** Outcome of reading a `.dripl` document. */
export interface ParsedDriplDocument {
  /** Viewport and UI state carried by the document, if any. */
  appState: unknown;
  /** Elements that can be loaded, in document order. */
  elements: DriplElement[];
  /**
   * True when at least one source element failed schema validation and was
   * recovered by normalisation instead. A caller that replaces the canvas
   * must treat this as a failure: the user asked to discard their scene in
   * exchange for this file, and half of it is not what they asked for.
   */
  partial: boolean;
  /** Source elements that could not be used at all. */
  dropped: number;
}

/**
 * Read a `.dripl` document, or throw if it is not one.
 *
 * Document validity is decided here and nowhere else. Accepts both shapes the
 * writer emits and that older files carry: a bare element array, and the
 * `{ version, type, elements, appState }` envelope.
 *
 * When every element satisfies `CanvasContentSchema` the result is exact and
 * `partial` is false. Otherwise elements are salvaged individually — the file
 * is still worth opening, because a user who picked it expects to see what is
 * in it — and the result is flagged so the caller can decide whether a partial
 * load is acceptable. Silently returning a partial scene as a success is the
 * one outcome this function exists to make impossible.
 */
export function parseDriplDocument(raw: string): ParsedDriplDocument {
  // Measured in encoded UTF-8 bytes, and before `JSON.parse` — see the
  // `MAX_IMPORT_BYTES` note. An oversized document is refused without ever
  // being materialised as objects.
  if (new TextEncoder().encode(raw).byteLength > MAX_IMPORT_BYTES) {
    throw new Error('Scene file is too large');
  }

  const parsed: unknown = JSON.parse(raw);
  const sourceElements = Array.isArray(parsed)
    ? parsed
    : isJsonRecord(parsed) && Array.isArray(parsed.elements)
      ? parsed.elements
      : null;
  if (sourceElements === null) throw new Error('Invalid .dripl file format');

  const appState = isJsonRecord(parsed) ? parsed.appState : undefined;
  const capped = sourceElements.slice(0, MAX_IMPORT_ELEMENTS);
  // Elements past the cap are not "partial" — they are a documented limit,
  // and counting them as drops would report a corruption that did not happen.
  const droppedByCap = sourceElements.length - capped.length;

  const strict = CanvasContentSchema.safeParse(capped);
  if (strict.success) {
    return {
      appState,
      elements: strict.data as DriplElement[],
      partial: false,
      dropped: droppedByCap,
    };
  }

  const files = isJsonRecord(parsed) && isJsonRecord(parsed.files) ? parsed.files : {};
  const seenIds = new Set<string>();
  const salvaged: DriplElement[] = [];
  for (const candidate of capped) {
    const element = normalizeImportedElement(candidate, files);
    // A duplicate id would collide with an earlier element in the same file;
    // keeping the first occurrence matches what the merge path already did.
    if (!element || seenIds.has(element.id)) continue;
    seenIds.add(element.id);
    salvaged.push(element);
  }

  if (salvaged.length === 0) {
    throw new Error('No valid elements found in the selected file');
  }

  return {
    appState,
    elements: salvaged,
    partial: true,
    dropped: capped.length - salvaged.length + droppedByCap,
  };
}
