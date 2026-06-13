import type { DriplElement, Point } from '@dripl/common';
import type { Bounds, AppState } from '@/types/canvas';
import { getElementBounds, isPointInElement } from '@dripl/math/intersection';
import { getDefaultFontFamily } from './fontPreferences';
import { applyStrokeStyle } from './canvas-helpers';
export type { Point, Bounds, AppState };
export type { DriplElement };

/**
 * Normalizes an element to ensure all required fields exist and have valid values
 * Fixes rendering inconsistencies by standardizing element structure
 */
export function normalizeElement(element: DriplElement): DriplElement {
  const normalized = {
    // Copy all properties first
    ...element,
    // Ensure all required fields are present
    id: element.id || generateId(),
    type: element.type || 'rectangle',
    x: element.x ?? 0,
    y: element.y ?? 0,
    width: element.width ?? 100,
    height: element.height ?? 100,
    angle: typeof element.angle === 'number' ? element.angle : 0,
    version: element.version || 1,
    versionNonce: element.versionNonce || Math.floor(Math.random() * 2_147_483_647),
    opacity: typeof element.opacity === 'number' ? element.opacity : 1,
    strokeColor: element.strokeColor || '#000000',
    strokeWidth: element.strokeWidth ?? 2,
    strokeStyle: element.strokeStyle || 'solid',
    backgroundColor: element.backgroundColor || 'transparent',
    fillStyle: element.fillStyle || 'hachure',
    roughness: element.roughness ?? 1,
    isDeleted: element.isDeleted || false,
    updated: element.updated || Date.now(),
  } as DriplElement;

  // Ensure width and height are at least 1px to avoid rendering issues
  normalized.width = Math.max(normalized.width, 1);
  normalized.height = Math.max(normalized.height, 1);

  // Ensure angle is between 0 and 2π
  if (typeof normalized.angle === 'number') {
    normalized.angle = normalized.angle % (2 * Math.PI);
    if (normalized.angle < 0) {
      normalized.angle += 2 * Math.PI;
    }
  } else {
    normalized.angle = 0;
  }

  // Ensure points array exists for line-based elements
  if (
    (normalized.type === 'line' || normalized.type === 'arrow' || normalized.type === 'freedraw') &&
    (!normalized.points || !Array.isArray(normalized.points))
  ) {
    normalized.points = [];
  }

  // For text elements, ensure text property exists
  if (normalized.type === 'text' && !normalized.text) {
    normalized.text = '';
    normalized.fontSize = normalized.fontSize || 20;
    normalized.fontFamily = normalized.fontFamily || getDefaultFontFamily();
  }

  // For image elements, ensure src property exists
  if (normalized.type === 'image' && !normalized.src) {
    normalized.src = '';
  }

  // For frame elements, ensure padding property exists
  if (normalized.type === 'frame' && typeof normalized.padding !== 'number') {
    normalized.padding = 20;
  }

  return normalized;
}

export const STORAGE_KEYS = {
  ELEMENTS: 'dripl-elements',
  STATE: 'dripl-state',
};

export { getElementBounds, isPointInElement };

export function drawShape(
  ctx: CanvasRenderingContext2D,
  element: DriplElement,
  isSelected: boolean = false
): void {
  ctx.save();

  ctx.globalAlpha = element.opacity ?? 1;

  if (element.angle) {
    const centerX = element.x + element.width / 2;
    const centerY = element.y + element.height / 2;
    ctx.translate(centerX, centerY);
    ctx.rotate(element.angle);
    ctx.translate(-centerX, -centerY);
  }

  ctx.strokeStyle = element.strokeColor ?? '#000000';
  ctx.lineWidth = element.strokeWidth ?? 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  applyStrokeStyle(ctx, element.strokeStyle);

  if (element.backgroundColor && element.backgroundColor !== 'transparent') {
    ctx.fillStyle = element.backgroundColor;
  }

  switch (element.type) {
    case 'rectangle':
      drawRectangle(ctx, element);
      break;
    case 'ellipse':
      drawEllipse(ctx, element);
      break;
    case 'diamond':
      drawDiamond(ctx, element);
      break;
    case 'arrow':
      drawArrow(ctx, element);
      break;
    case 'line':
      drawLine(ctx, element);
      break;
    case 'freedraw':
      drawFreedraw(ctx, element);
      break;
    case 'text':
      drawText(ctx, element);
      break;
    case 'frame':
      drawFrame(ctx, element);
      break;
  }

  ctx.restore();
}

function drawRectangle(ctx: CanvasRenderingContext2D, element: DriplElement): void {
  const roundnessValue =
    typeof element.roundness === 'object' && element.roundness !== null
      ? element.roundness.type
      : element.roundness || 0;
  const radius = roundnessValue * 12;

  if (radius > 0) {
    ctx.beginPath();
    ctx.moveTo(element.x + radius, element.y);
    ctx.lineTo(element.x + element.width - radius, element.y);
    ctx.quadraticCurveTo(
      element.x + element.width,
      element.y,
      element.x + element.width,
      element.y + radius
    );
    ctx.lineTo(element.x + element.width, element.y + element.height - radius);
    ctx.quadraticCurveTo(
      element.x + element.width,
      element.y + element.height,
      element.x + element.width - radius,
      element.y + element.height
    );
    ctx.lineTo(element.x + radius, element.y + element.height);
    ctx.quadraticCurveTo(
      element.x,
      element.y + element.height,
      element.x,
      element.y + element.height - radius
    );
    ctx.lineTo(element.x, element.y + radius);
    ctx.quadraticCurveTo(element.x, element.y, element.x + radius, element.y);
    ctx.closePath();
  } else {
    ctx.beginPath();
    ctx.rect(element.x, element.y, element.width, element.height);
    ctx.closePath();
  }

  if (element.backgroundColor !== 'transparent') {
    ctx.fill();
  }
  ctx.stroke();
}

function drawEllipse(ctx: CanvasRenderingContext2D, element: DriplElement): void {
  const centerX = element.x + element.width / 2;
  const centerY = element.y + element.height / 2;
  const radiusX = element.width / 2;
  const radiusY = element.height / 2;

  ctx.beginPath();
  ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
  ctx.closePath();

  if (element.backgroundColor !== 'transparent') {
    ctx.fill();
  }
  ctx.stroke();
}

function drawDiamond(ctx: CanvasRenderingContext2D, element: DriplElement): void {
  const centerX = element.x + element.width / 2;
  const centerY = element.y + element.height / 2;

  ctx.beginPath();
  ctx.moveTo(centerX, element.y);
  ctx.lineTo(element.x + element.width, centerY);
  ctx.lineTo(centerX, element.y + element.height);
  ctx.lineTo(element.x, centerY);
  ctx.closePath();

  if (element.backgroundColor !== 'transparent') {
    ctx.fill();
  }
  ctx.stroke();
}

function drawArrow(ctx: CanvasRenderingContext2D, element: DriplElement): void {
  if (!element.points || element.points.length < 2) return;

  const ox = element.x;
  const oy = element.y;

  ctx.beginPath();
  const firstPoint = element.points[0];
  if (!firstPoint) return;

  ctx.moveTo(firstPoint.x + ox, firstPoint.y + oy);
  for (let i = 1; i < element.points.length; i++) {
    const point = element.points[i];
    if (!point) continue;
    ctx.lineTo(point.x + ox, point.y + oy);
  }
  ctx.stroke();

  const lastPoint = element.points[element.points.length - 1];
  const secondLastPoint = element.points[element.points.length - 2];
  if (lastPoint === undefined || secondLastPoint === undefined) return;
  const angle = Math.atan2(lastPoint.y - secondLastPoint.y, lastPoint.x - secondLastPoint.x);
  const arrowLength = 15;

  ctx.beginPath();
  ctx.moveTo(lastPoint.x + ox, lastPoint.y + oy);
  ctx.lineTo(
    lastPoint.x + ox - arrowLength * Math.cos(angle - Math.PI / 6),
    lastPoint.y + oy - arrowLength * Math.sin(angle - Math.PI / 6)
  );
  ctx.moveTo(lastPoint.x + ox, lastPoint.y + oy);
  ctx.lineTo(
    lastPoint.x + ox - arrowLength * Math.cos(angle + Math.PI / 6),
    lastPoint.y + oy - arrowLength * Math.sin(angle + Math.PI / 6)
  );
  ctx.stroke();
}

function drawLine(ctx: CanvasRenderingContext2D, element: DriplElement): void {
  if (!element.points || element.points.length < 2) return;

  const ox = element.x;
  const oy = element.y;

  const firstPoint = element.points[0];
  if (!firstPoint) return;

  ctx.beginPath();
  ctx.moveTo(firstPoint.x + ox, firstPoint.y + oy);
  for (let i = 1; i < element.points.length; i++) {
    const point = element.points[i];
    if (!point) continue;
    ctx.lineTo(point.x + ox, point.y + oy);
  }
  ctx.stroke();
}

function drawFreedraw(ctx: CanvasRenderingContext2D, element: DriplElement): void {
  if (!element.points || element.points.length < 2) return;

  const ox = element.x;
  const oy = element.y;

  const firstPoint = element.points[0];
  if (!firstPoint) return;

  ctx.beginPath();
  ctx.moveTo(firstPoint.x + ox, firstPoint.y + oy);

  for (let i = 1; i < element.points.length - 1; i++) {
    const currentPoint = element.points[i];
    const nextPoint = element.points[i + 1];
    if (!currentPoint || !nextPoint) continue;

    const xc = (currentPoint.x + nextPoint.x) / 2 + ox;
    const yc = (currentPoint.y + nextPoint.y) / 2 + oy;
    ctx.quadraticCurveTo(currentPoint.x + ox, currentPoint.y + oy, xc, yc);
  }

  const lastPoint = element.points[element.points.length - 1];
  if (lastPoint) {
    ctx.lineTo(lastPoint.x + ox, lastPoint.y + oy);
  }
  ctx.stroke();
}

function drawText(ctx: CanvasRenderingContext2D, element: DriplElement): void {
  if (!element.text) return;

  const fontSize = element.fontSize || 20;
  const fontFamily = element.fontFamily || getDefaultFontFamily();

  ctx.font = `${fontSize}px ${fontFamily}, cursive`;
  ctx.fillStyle = element.strokeColor ?? '#000000';
  ctx.textBaseline = 'top';

  const words = element.text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine + (currentLine ? ' ' : '') + word;
    const metrics = ctx.measureText(testLine);

    if (metrics.width > element.width && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);

  const lineHeight = fontSize * 1.25;
  lines.forEach((line, i) => {
    ctx.fillText(line, element.x + 5, element.y + 5 + i * lineHeight);
  });
}

function drawFrame(ctx: CanvasRenderingContext2D, element: DriplElement): void {
  const frameElement = element as DriplElement & { padding?: number; title?: string };

  // Draw frame border
  ctx.strokeRect(element.x, element.y, element.width, element.height);

  // Draw padding
  const padding = frameElement.padding || 20;
  ctx.setLineDash([5, 5]);
  ctx.strokeRect(
    element.x + padding,
    element.y + padding,
    element.width - 2 * padding,
    element.height - 2 * padding
  );
  ctx.setLineDash([]);

  // Draw title
  if (frameElement.title) {
    ctx.fillStyle = element.strokeColor ?? '#000000';
    ctx.font = `14px ${getDefaultFontFamily()}, cursive`;
    ctx.fillText(frameElement.title, element.x + 10, element.y - 10);
  }
}

export function exportToPNG(canvas: HTMLCanvasElement, filename: string = 'canvas.png'): void {
  canvas.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = filename;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  });
}

export function exportToJSON(elements: DriplElement[], filename: string = 'canvas.json'): void {
  // Normalize elements before exporting to ensure complete state
  const normalizedElements = elements.map(normalizeElement);

  const json = JSON.stringify(
    {
      elements: normalizedElements,
      version: '1.0',
    },
    null,
    2
  );
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

export function importFromJSON(file: File): Promise<DriplElement[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const json = JSON.parse(e.target?.result as string);
        const rawElements = json.elements || [];

        // Normalize all elements
        const normalizedElements = rawElements.map(normalizeElement);

        // Re-sort elements by fractional index (or y-position fallback)
        const sortedElements = [...normalizedElements].sort((a, b) => {
          if (a.fractionalIndex && b.fractionalIndex) {
            if (a.fractionalIndex < b.fractionalIndex) return -1;
            if (a.fractionalIndex > b.fractionalIndex) return 1;
            return 0;
          }
          return (a.y || 0) - (b.y || 0);
        });

        resolve(sortedElements);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}
