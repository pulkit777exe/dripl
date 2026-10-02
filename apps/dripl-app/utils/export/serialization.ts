import { v4 as uuidv4 } from 'uuid';
import { MAX_SCENE_ELEMENTS, type DriplElement } from '@dripl/common';
import { exportToPng } from './raster';
import { exportToSvg } from './vector';
import {
  finiteNumber,
  isJsonRecord,
  isSafeHttpUrl,
  normalizeImportedElement,
  remapElementReferences,
  type JsonRecord,
} from './normalize';

export const EXCALIDRAW_SCHEMA_VERSION = 2;
export const MAX_IMPORT_ELEMENTS = MAX_SCENE_ELEMENTS;

function toExcalidrawBinding(value: unknown, includeFixedPoint = false): JsonRecord | null {
  if (!isJsonRecord(value) || typeof value.elementId !== 'string') return null;
  const binding: JsonRecord = {
    elementId: value.elementId,
    focus: typeof value.focus === 'number' ? value.focus : 0,
    gap: typeof value.gap === 'number' ? value.gap : 1,
  };
  if (includeFixedPoint && isJsonRecord(value.fixedPoint)) {
    binding.fixedPoint = [finiteNumber(value.fixedPoint.x, 0), finiteNumber(value.fixedPoint.y, 0)];
  } else if (includeFixedPoint && Array.isArray(value.fixedPoint) && value.fixedPoint.length >= 2) {
    binding.fixedPoint = [
      finiteNumber(value.fixedPoint[0], 0),
      finiteNumber(value.fixedPoint[1], 0),
    ];
  }
  return binding;
}

function toExcalidrawArrowhead(value: unknown): string | null {
  if (value === 'none' || value === null || value === undefined) return null;
  if (value === 'triangle') return 'arrow';
  if (value === 'bar' || value === 'dot' || value === 'diamond') return value;
  return null;
}

function toExcalidrawElement(element: DriplElement): JsonRecord {
  const source = element as unknown as JsonRecord;
  // rotation/flips/zIndex are omitted from the Excalidraw export via rest destructuring.
  /* eslint-disable @typescript-eslint/no-unused-vars -- intentionally omitted_export_fields */
  const {
    fractionalIndex,
    groupId,
    containerId,
    rotation,
    flipHorizontal,
    flipVertical,
    zIndex,
    points,
    arrowHeads,
    arrowStyle,
    startBinding,
    endBinding,
    ...base
  } = source;
  /* eslint-enable @typescript-eslint/no-unused-vars */
  const exported: JsonRecord = {
    ...base,
    id: element.id,
    type: element.type === 'embed' ? 'embeddable' : element.type,
    index: typeof fractionalIndex === 'string' ? fractionalIndex : null,
    groupIds: typeof groupId === 'string' && groupId ? [groupId] : [],
    frameId: typeof containerId === 'string' && containerId ? containerId : null,
    boundElements: Array.isArray(element.boundElements)
      ? element.boundElements.map(bound => ({ id: bound.id, type: bound.type }))
      : null,
    link: typeof source.link === 'string' && isSafeHttpUrl(source.link) ? source.link : null,
    roundness: null,
    updated: typeof source.updated === 'number' ? source.updated : Date.now(),
  };

  if (element.type === 'line' || element.type === 'arrow') {
    exported.points = Array.isArray(points)
      ? points.map(point => {
          const record = isJsonRecord(point) ? point : {};
          return [finiteNumber(record.x, 0), finiteNumber(record.y, 0)];
        })
      : [];
    exported.startBinding = toExcalidrawBinding(startBinding, arrowStyle === 'elbow');
    exported.endBinding = toExcalidrawBinding(endBinding, arrowStyle === 'elbow');
    const heads = isJsonRecord(arrowHeads) ? arrowHeads : {};
    exported.startArrowhead = toExcalidrawArrowhead(heads.start);
    exported.endArrowhead = toExcalidrawArrowhead(heads.end);
    exported.lastCommittedPoint = null;
    if (element.type === 'arrow') {
      exported.elbowed = arrowStyle === 'elbow';
      exported.fixedSegments = null;
      exported.startIsSpecial = null;
      exported.endIsSpecial = null;
    }
  }

  if (element.type === 'text') {
    exported.containerId = typeof containerId === 'string' && containerId ? containerId : null;
    exported.originalText =
      typeof source.originalText === 'string' ? source.originalText : element.text;
    exported.autoResize = true;
    exported.lineHeight = finiteNumber(source.lineHeight, 1.25);
  }

  if (element.type === 'image') {
    // Excalidraw references binary files by their stable element/file id, not
    // by the data URL or transport URL itself. The files map below carries
    // embedded data URLs; remote sources remain a safe link rather than a
    // fabricated inline file.
    exported.fileId = element.id;
    exported.status = 'saved';
    exported.scale = [1, 1];
    exported.crop = null;
  }

  if (element.type === 'embed') {
    const embedUrl = typeof source.url === 'string' ? source.url : source.link;
    if (typeof embedUrl === 'string' && isSafeHttpUrl(embedUrl)) {
      exported.link = embedUrl;
    }
  }

  if (element.type === 'frame') {
    exported.name = typeof source.title === 'string' ? source.title : null;
  }

  return exported;
}

export function exportToJson(elements: DriplElement[]): Blob {
  return new Blob([JSON.stringify(elements, null, 2)], {
    type: 'application/json',
  });
}

/** Export a native, editable Excalidraw scene document. */
export function exportToExcalidraw(
  elements: DriplElement[],
  appState: Record<string, unknown> = {}
): Blob {
  const document = {
    type: 'excalidraw',
    version: EXCALIDRAW_SCHEMA_VERSION,
    source: 'dripl',
    elements: elements.map(toExcalidrawElement),
    appState,
    files: Object.fromEntries(
      elements.flatMap(element => {
        const src =
          element.type === 'image' && typeof (element as { src?: unknown }).src === 'string'
            ? (element as { src: string }).src
            : '';
        if (!src.startsWith('data:')) return [];
        return [
          [
            element.id,
            {
              mimeType: src.startsWith('data:image/png')
                ? 'image/png'
                : src.startsWith('data:image/jpeg')
                  ? 'image/jpeg'
                  : src.startsWith('data:image/gif')
                    ? 'image/gif'
                    : 'image/webp',
              id: element.id,
              dataURL: src,
              created: Date.now(),
            },
          ],
        ];
      })
    ),
  };
  return new Blob([JSON.stringify(document, null, 2)], {
    type: 'application/json',
  });
}

export function exportCanvas(
  format: 'png' | 'svg' | 'json' | 'excalidraw',
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
  if (format === 'excalidraw') {
    return exportToExcalidraw(elements, options?.appState);
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
