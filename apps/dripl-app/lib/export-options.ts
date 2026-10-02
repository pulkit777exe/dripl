import type { DriplElement } from '@dripl/common';

/**
 * Export option builders — pure helpers extracted from `ExportModal`.
 *
 * Scope resolution (selection-only vs full scene), custom-dimension
 * parsing, and per-format option assembly are closed-form data mapping;
 * the modal keeps the async orchestration (jsPDF, clipboard, download).
 */

export interface ExportDimensions {
  width?: number;
  height?: number;
}

/** Parse the custom-size form fields; blank/disabled input means unset. */
export function parseExportDimensions(
  useCustomSize: boolean,
  customWidth: string,
  customHeight: string
): ExportDimensions {
  if (!useCustomSize || !customWidth || !customHeight) {
    return { width: undefined, height: undefined };
  }
  return {
    width: parseInt(customWidth, 10),
    height: parseInt(customHeight, 10),
  };
}

/** Resolve which elements an export/copy operates on. */
export function resolveExportScope(
  elements: DriplElement[],
  selectedIds: ReadonlySet<string>,
  selectionOnly: boolean
): DriplElement[] {
  if (selectionOnly && selectedIds.size > 0) {
    return elements.filter(el => selectedIds.has(el.id));
  }
  return elements;
}

export interface RasterExportOptions {
  scale: number;
  background: string;
  padding: number;
  customWidth?: number;
  customHeight?: number;
}
export interface DocumentExportOptions extends RasterExportOptions {
  scale: number;
  appState?: Record<string, unknown>;
}

/** Fixed-scale raster options for the PDF and copy-to-clipboard paths. */
export function buildRasterExportOptions(
  dims: ExportDimensions,
  background = '#ffffff'
): RasterExportOptions {
  return {
    scale: 2,
    background,
    padding: 16,
    ...(dims.width && dims.height ? { customWidth: dims.width, customHeight: dims.height } : {}),
  };
}

/**
 * Document options for the png/svg/json/excalidraw download path. Custom
 * widths reinterpret `scale` against a 1920px reference frame.
 */
export function buildDocumentExportOptions(
  scale: number,
  dims: ExportDimensions,
  appState?: Record<string, unknown>,
  background = '#ffffff'
): DocumentExportOptions {
  return {
    scale: dims.width ? dims.width / 1920 : scale,
    background,
    padding: 16,
    ...(dims.width && dims.height ? { customWidth: dims.width, customHeight: dims.height } : {}),
    appState,
  };
}

const EXTENSIONS: Record<string, string> = {
  png: 'png',
  svg: 'svg',
  json: 'json',
  excalidraw: 'excalidraw',
  pdf: 'pdf',
};

/** Timestamped download filename for an export format. */
export function exportFileName(format: string, now: number = Date.now()): string {
  return `canvas-${now}.${EXTENSIONS[format] ?? format}`;
}
