import { v4 as uuidv4 } from 'uuid';
import { MAX_SCENE_ELEMENTS, type DriplElement } from '@dripl/common';
import { exportToPng } from './raster';
import { exportToSvg } from './vector';
import { exportToDripl } from './native';
import { isJsonRecord, normalizeImportedElement, remapElementReferences } from './normalize';

export const MAX_IMPORT_ELEMENTS = MAX_SCENE_ELEMENTS;

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

export function importFromJson(
  raw: string,
  currentElements: DriplElement[],
  mode: 'merge' | 'replace' = 'merge'
): DriplElement[] {
  if (raw.length > 5_000_000) throw new Error('Scene file is too large');
  const parsed = JSON.parse(raw) as unknown;
  const sourceElements = Array.isArray(parsed)
    ? parsed
    : isJsonRecord(parsed) && Array.isArray(parsed.elements)
      ? parsed.elements
      : [];
  const files = isJsonRecord(parsed) && isJsonRecord(parsed.files) ? parsed.files : {};
  const seenImportIds = new Set<string>();
  const normalized = sourceElements
    .slice(0, MAX_IMPORT_ELEMENTS)
    .map(element => normalizeImportedElement(element, files))
    .filter((element): element is DriplElement => {
      if (!element || seenImportIds.has(element.id)) return false;
      seenImportIds.add(element.id);
      return true;
    });

  if (normalized.length === 0) {
    throw new Error('No valid elements found in the selected file');
  }

  if (mode === 'replace') {
    return normalized;
  }

  const ids = new Map<string, string>();
  const merged = normalized.map(element => {
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
  return [...currentElements, ...fullyRemapped];
}
