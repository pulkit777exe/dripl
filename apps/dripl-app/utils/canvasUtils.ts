import { CanvasElement, Point, Bounds, AppState } from "@/types/canvas";
export type { CanvasElement, Point, Bounds, AppState };

export const STORAGE_KEYS = {
  ELEMENTS: "dripl-elements",
  STATE: "dripl-state",
};

/**
 * Get the bounding box of an element
 */
export function getElementBounds(element: CanvasElement): Bounds {
  if (element.points && element.points.length > 0) {
    const xs = element.points.map((p) => p.x);
    const ys = element.points.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  return {
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
  };
}

/**
 * Check if a point is inside an element
 */
export function isPointInElement(
  point: Point,
  element: CanvasElement
): boolean {
  const bounds = getElementBounds(element);

  if (element.rotation) {
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const rotatedPoint = rotatePoint(
      point,
      { x: centerX, y: centerY },
      -element.rotation
    );
    point = rotatedPoint;
  }

  switch (element.type) {
    case "rectangle":
    case "diamond":
    case "text":
      return isPointInRect(point, bounds);

    case "circle":
      return isPointInEllipse(point, bounds);

    case "arrow":
    case "line":
    case "freedraw":
      return isPointNearPath(point, element.points || [], element.strokeWidth);

    default:
      return false;
  }
}

/**
 * Check if point is in rectangle
 */
function isPointInRect(point: Point, bounds: Bounds): boolean {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

/**
 * Check if point is in ellipse
 */
function isPointInEllipse(point: Point, bounds: Bounds): boolean {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const radiusX = bounds.width / 2;
  const radiusY = bounds.height / 2;

  const normalizedX = (point.x - centerX) / radiusX;
  const normalizedY = (point.y - centerY) / radiusY;

  return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
}

/**
 * Check if point is near a path (for lines and freedraw)
 */
function isPointNearPath(
  point: Point,
  points: Point[],
  threshold: number = 5
): boolean {
  if (points.length < 2) return false;

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    if (!p1 || !p2) continue;

    const distance = distanceToLineSegment(point, p1, p2);
    if (distance <= threshold) return true;
  }

  return false;
}

/**
 * Calculate distance from point to line segment
 */
function distanceToLineSegment(
  point: Point,
  lineStart: Point,
  lineEnd: Point
): number {
  const A = point.x - lineStart.x;
  const B = point.y - lineStart.y;
  const C = lineEnd.x - lineStart.x;
  const D = lineEnd.y - lineStart.y;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;

  if (lenSq !== 0) param = dot / lenSq;

  let xx, yy;

  if (param < 0) {
    xx = lineStart.x;
    yy = lineStart.y;
  } else if (param > 1) {
    xx = lineEnd.x;
    yy = lineEnd.y;
  } else {
    xx = lineStart.x + param * C;
    yy = lineStart.y + param * D;
  }

  const dx = point.x - xx;
  const dy = point.y - yy;

  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Rotate a point around a center
 */
function rotatePoint(point: Point, center: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - center.x;
  const dy = point.y - center.y;

  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

/**
 * Draw a shape on canvas context
 */
export function drawShape(
  ctx: CanvasRenderingContext2D,
  element: CanvasElement,
  isSelected: boolean = false
): void {
  ctx.save();

  ctx.globalAlpha = element.opacity / 100;

  if (element.rotation) {
    const centerX = element.x + element.width / 2;
    const centerY = element.y + element.height / 2;
    ctx.translate(centerX, centerY);
    ctx.rotate(element.rotation);
    ctx.translate(-centerX, -centerY);
  }

  ctx.strokeStyle = element.strokeColor;
  ctx.lineWidth = element.strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (element.strokeStyle === "dashed") {
    ctx.setLineDash([10, 5]);
  } else if (element.strokeStyle === "dotted") {
    ctx.setLineDash([2, 3]);
  } else {
    ctx.setLineDash([]);
  }

  if (element.backgroundColor !== "transparent") {
    ctx.fillStyle = element.backgroundColor;
  }

  switch (element.type) {
    case "rectangle":
      drawRectangle(ctx, element);
      break;
    case "circle":
      drawCircle(ctx, element);
      break;
    case "diamond":
      drawDiamond(ctx, element);
      break;
    case "arrow":
      drawArrow(ctx, element);
      break;
    case "line":
      drawLine(ctx, element);
      break;
    case "freedraw":
      drawFreedraw(ctx, element);
      break;
    case "text":
      drawText(ctx, element);
      break;
  }

  ctx.restore();
}

function drawRectangle(
  ctx: CanvasRenderingContext2D,
  element: CanvasElement
): void {
  const roundnessValue =
    typeof element.roundness === "object"
      ? element.roundness.type
      : element.roundness;
  const radius = roundnessValue * 12;

  if (radius > 0) {
    // Rounded rectangle
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

  if (element.backgroundColor !== "transparent") {
    ctx.fill();
  }
  ctx.stroke();
}

function drawCircle(
  ctx: CanvasRenderingContext2D,
  element: CanvasElement
): void {
  const centerX = element.x + element.width / 2;
  const centerY = element.y + element.height / 2;
  const radiusX = element.width / 2;
  const radiusY = element.height / 2;

  ctx.beginPath();
  ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
  ctx.closePath();

  if (element.backgroundColor !== "transparent") {
    ctx.fill();
  }
  ctx.stroke();
}

function drawDiamond(
  ctx: CanvasRenderingContext2D,
  element: CanvasElement
): void {
  const centerX = element.x + element.width / 2;
  const centerY = element.y + element.height / 2;

  ctx.beginPath();
  ctx.moveTo(centerX, element.y);
  ctx.lineTo(element.x + element.width, centerY);
  ctx.lineTo(centerX, element.y + element.height);
  ctx.lineTo(element.x, centerY);
  ctx.closePath();

  if (element.backgroundColor !== "transparent") {
    ctx.fill();
  }
  ctx.stroke();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  element: CanvasElement
): void {
  if (!element.points || element.points.length < 2) return;

  // Draw line
  ctx.beginPath();
  const firstPoint = element.points[0];
  if (!firstPoint) return;

  ctx.moveTo(firstPoint.x, firstPoint.y);
  for (let i = 1; i < element.points.length; i++) {
    const point = element.points[i];
    if (!point) continue;
    ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();

  // Draw arrowhead at the end
  const lastPoint = element.points[element.points.length - 1];
  const secondLastPoint = element.points[element.points.length - 2];
  if (lastPoint === undefined || secondLastPoint === undefined) return;
  const angle = Math.atan2(
    lastPoint.y - secondLastPoint.y,
    lastPoint.x - secondLastPoint.x
  );
  const arrowLength = 15;
  const arrowWidth = 10;

  ctx.beginPath();
  ctx.moveTo(lastPoint.x, lastPoint.y);
  ctx.lineTo(
    lastPoint.x - arrowLength * Math.cos(angle - Math.PI / 6),
    lastPoint.y - arrowLength * Math.sin(angle - Math.PI / 6)
  );
  ctx.moveTo(lastPoint.x, lastPoint.y);
  ctx.lineTo(
    lastPoint.x - arrowLength * Math.cos(angle + Math.PI / 6),
    lastPoint.y - arrowLength * Math.sin(angle + Math.PI / 6)
  );
  ctx.stroke();
}

function drawLine(ctx: CanvasRenderingContext2D, element: CanvasElement): void {
  if (!element.points || element.points.length < 2) return;

  const firstPoint = element.points[0];
  if (!firstPoint) return;

  ctx.beginPath();
  ctx.moveTo(firstPoint.x, firstPoint.y);
  for (let i = 1; i < element.points.length; i++) {
    const point = element.points[i];
    if (!point) continue;
    ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
}

function drawFreedraw(
  ctx: CanvasRenderingContext2D,
  element: CanvasElement
): void {
  if (!element.points || element.points.length < 2) return;

  const firstPoint = element.points[0];
  if (!firstPoint) return;

  ctx.beginPath();
  ctx.moveTo(firstPoint.x, firstPoint.y);

  // Use quadratic curves for smoother lines
  for (let i = 1; i < element.points.length - 1; i++) {
    const currentPoint = element.points[i];
    const nextPoint = element.points[i + 1];
    if (!currentPoint || !nextPoint) continue;

    const xc = (currentPoint.x + nextPoint.x) / 2;
    const yc = (currentPoint.y + nextPoint.y) / 2;
    ctx.quadraticCurveTo(currentPoint.x, currentPoint.y, xc, yc);
  }

  // Last point
  const lastPoint = element.points[element.points.length - 1];
  if (lastPoint) {
    ctx.lineTo(lastPoint.x, lastPoint.y);
  }
  ctx.stroke();
}

function drawText(ctx: CanvasRenderingContext2D, element: CanvasElement): void {
  if (!element.text) return;

  const fontSize = element.fontSize || 16;
  const fontFamily = element.fontFamily || "Arial";

  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.fillStyle = element.strokeColor;
  ctx.textBaseline = "top";

  // Draw text with word wrap
  const words = element.text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine + (currentLine ? " " : "") + word;
    const metrics = ctx.measureText(testLine);

    if (metrics.width > element.width && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);

  // Draw each line
  const lineHeight = fontSize * 1.2;
  lines.forEach((line, i) => {
    ctx.fillText(line, element.x + 5, element.y + 5 + i * lineHeight);
  });
}

/**
 * Export canvas to PNG
 */
export function exportToPNG(
  canvas: HTMLCanvasElement,
  filename: string = "canvas.png"
): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = filename;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  });
}

/**
 * Export canvas state to JSON
 */
export function exportToJSON(
  elements: CanvasElement[],
  filename: string = "canvas.json"
): void {
  const json = JSON.stringify({ elements, version: "1.0" }, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = filename;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Import canvas state from JSON
 */
export function importFromJSON(file: File): Promise<CanvasElement[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        resolve(json.elements || []);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

/**
 * Generate unique ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
export const saveToLocalStorage = (
  elements: CanvasElement[],
  appState: Partial<AppState>
) => {
  try {
    localStorage.setItem(STORAGE_KEYS.ELEMENTS, JSON.stringify(elements));
    localStorage.setItem(STORAGE_KEYS.STATE, JSON.stringify(appState));
  } catch (error) {
    console.error("Error saving to local storage:", error);
  }
};

export const loadFromLocalStorage = () => {
  try {
    const elements = localStorage.getItem(STORAGE_KEYS.ELEMENTS);
    const state = localStorage.getItem(STORAGE_KEYS.STATE);

    return {
      elements: elements ? JSON.parse(elements) : null,
      appState: state ? JSON.parse(state) : null,
    };
  } catch (error) {
    console.error("Error loading from local storage:", error);
    return { elements: null, appState: null };
  }
};
