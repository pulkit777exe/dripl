import { v4 as uuidv4 } from 'uuid';
import type { DriplElement } from '@dripl/common';
import { exportToPng } from './raster';
import { exportToSvg } from './vector';
import { exportToDripl, parseDriplDocument, MAX_IMPORT_ELEMENTS } from './native';
import { remapElementReferences } from './normalize';

// Re-exported from `./native` because the cap is a property of the document
// format, and the parser that enforces it lives beside the writer.
export { MAX_IMPORT_ELEMENTS };

export function exportToJson(elements: DriplElement[]): Blob {
  return new Blob([JSON.stringify(elements, null, 2)], {
    type: 'application/json',
  });
}

export function exportCanvas(
  format: 'png' | 'svg' | 'json' | 'dripl',
  elements: DriplElement[],
  options?: {
    scale?: number;
    background?: string;
    padding?: number;
    customWidth?: number;
    customHeight?: number;
    appState?: Record<string, unknown>;
  }
): Promise<Blob> | Blob {
  if (format === 'png') {
    return exportToPng(elements, options);
  }
  if (format === 'svg') {
    return exportToSvg(elements, options);
  }
  if (format === 'dripl') {
    return exportToDripl(elements, options?.appState);
  }
  return exportToJson(elements);
}

/** What an import produced, and what it could not. */
export interface ImportResult {
  /** The scene to load: the current elements merged, or the file's own. */
  elements: DriplElement[];
  /** Source elements that could not be used at all. */
  dropped: number;
  /** True when the file needed recovery to be understood. */
  partial: boolean;
}

/**
 * Merge an imported document into the current scene.
 *
 * `partial` and `dropped` are returned rather than swallowed: a caller that
 * reports a successful import while elements were silently discarded tells
 * the user their file loaded when it did not. The caller decides whether a
 * partial load is acceptable — it is, when the user kept their existing scene
 * and merged into it, and it is not, when they asked to replace it.
 */
export function importFromJson(
  raw: string,
  currentElements: DriplElement[],
  mode: 'merge' | 'replace' = 'merge'
): ImportResult {
  const document = parseDriplDocument(raw);

  if (mode === 'replace') {
    if (document.partial) {
      throw new Error(
        `This file is not a complete Dripl scene: ${document.dropped} of its elements could not be read. ` +
          'Import it as a merge to keep the parts that are readable.'
      );
    }
    return { elements: document.elements, dropped: document.dropped, partial: false };
  }

  const ids = new Map<string, string>();
  const merged = document.elements.map(element => {
    const id = uuidv4();
    ids.set(element.id, id);
    return remapElementReferences({ ...element, id, updated: Date.now() }, ids);
  });

  // Resolve references after all IDs are known. This keeps arrows, labels,
  // groups, and bound shapes connected when a file is merged into a scene.
  const fullyRemapped = merged.map(element => remapElementReferences(element, ids));
  if (currentElements.length + fullyRemapped.length > MAX_IMPORT_ELEMENTS) {
    throw new Error('Merged scene would exceed the supported element limit');
  }
  return {
    elements: [...currentElements, ...fullyRemapped],
    dropped: document.dropped,
    partial: document.partial,
  };
}
