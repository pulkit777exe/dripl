import { v4 as uuidv4 } from 'uuid';
import type { DriplElement } from '@dripl/common';
import { exportToPng } from './raster';
import { exportToSvg } from './vector';
import { exportToDripl, parseDriplDocument, MAX_IMPORT_ELEMENTS } from './native';
import { exportToCsv } from './csv';
import { remapElementReferences } from './normalize';

// Re-exported from `./native` because the cap is a property of the document
// format, and the parser that enforces it lives beside the writer.
export { MAX_IMPORT_ELEMENTS };

export function exportToJson(elements: DriplElement[]): Blob {
  return new Blob([JSON.stringify(elements, null, 2)], {
    type: 'application/json',
  });
}

/**
 * Serialise a scene in one of the formats this module writes itself.
 *
 * `'pdf'` is absent from the union by design and not by oversight: a PDF is a
 * rasterised page wrapped in a document, so `ExportModal` builds it from a PNG
 * plus `jsPDF` and returns before ever calling here. The union is the boundary
 * that keeps that split honest — `ExportFormat` is wider than this, and the
 * narrow type is what makes the call at `ExportModal` a compile error until the
 * `'pdf'` branch handles PDF itself.
 *
 * The dispatch ends in an explicit rejection rather than a residual
 * `return exportToJson(elements)`, because the union is erased at runtime and
 * the guarantee must not rest on one `if` in another file. `ExportModal`'s early
 * return is the only thing currently keeping `'pdf'` out of this call; move it,
 * reorder it, or lift it into a helper and `'pdf'` arrives here unhandled. With a
 * JSON fallthrough it would be handed to `downloadBlob` under
 * `exportFileName('pdf')` — a `.pdf` file containing JSON, reported to the user
 * as a success. Upstream Excalidraw ends its dispatch the same way
 * (`data/index.ts`: an explicit unsupported-export-type case). Throwing is safe
 * for every caller because each one already wraps the call in `try`/`catch`, so
 * an unhandled format becomes a logged, visible export failure instead of a
 * wrong file.
 */
export function exportCanvas(
  format: 'png' | 'svg' | 'json' | 'dripl' | 'csv',
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
  switch (format) {
    case 'png':
      return exportToPng(elements, options);
    case 'svg':
      return exportToSvg(elements, options);
    case 'dripl':
      return exportToDripl(elements, options?.appState);
    case 'json':
      return exportToJson(elements);
    case 'csv':
      return exportToCsv(elements);
    default: {
      // Widened before it reaches the message: in this branch `format` is
      // `never` under the union above, and an error naming one of the handled
      // formats would be worse than no error at all.
      const unhandled: string = format;
      throw new Error(
        `Unsupported export format: "${unhandled}". ` +
          'exportCanvas serialises png, svg, json, dripl and csv; any other format ' +
          '(pdf, for one) has to be built by the caller.'
      );
    }
  }
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
