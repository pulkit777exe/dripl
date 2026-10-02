import type { DriplElement } from '@dripl/common';

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
 */

export const DRIPL_SCENE_TYPE = 'dripl-scene';
export const DRIPL_SCENE_VERSION = 1;

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
