import type { DriplElement } from "@dripl/common";
import { renderRoughElements, createRoughCanvas } from "@dripl/element";

export interface CanvasMetadata {
  version: string;
  created: number;
  modified: number;
  author?: string;
  title?: string;
  description?: string;
}

const CANVAS_VERSION = "1.0.0";

export async function exportToPNG(
  elements: DriplElement[],
  options: {
    scale?: number;
    backgroundColor?: string;
    width?: number;
    height?: number;
  } = {}
): Promise<Blob> {
  const {
    scale = 2,
    backgroundColor = "#ffffff",
    width = 2000,
    height = 2000,
  } = options;

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get canvas context");

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const rc = createRoughCanvas(canvas);
  if (!rc) throw new Error("Failed to create Rough canvas");

  ctx.scale(scale, scale);

  renderRoughElements(rc, ctx, elements);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to create blob"));
        }
      },
      "image/png",
      1.0
    );
  });
}

export function exportToSVG(
  elements: DriplElement[],
  options: {
    width: number;
    height: number;
    backgroundColor?: string;
  }
): string {
  const { width, height, backgroundColor = "#ffffff" } = options;

  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="${backgroundColor}"/>
`;

  for (const element of elements) {
    if (element.isDeleted) continue;

    switch (element.type) {
      case "rectangle":
        svg += `  <rect x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" 
        fill="${element.backgroundColor}" stroke="${element.strokeColor}" stroke-width="${element.strokeWidth}" 
         opacity="${element.opacity}" transform="rotate(${(element.angle ?? 0) * (180 / Math.PI)} ${element.x + element.width / 2} ${element.y + element.height / 2})"/>\n`;
        break;
      case "ellipse":
        svg += `  <ellipse cx="${element.x + element.width / 2}" cy="${element.y + element.height / 2}" 
        rx="${element.width / 2}" ry="${element.height / 2}" 
        fill="${element.backgroundColor}" stroke="${element.strokeColor}" stroke-width="${element.strokeWidth}" 
         opacity="${element.opacity}" transform="rotate(${(element.angle ?? 0) * (180 / Math.PI)} ${element.x + element.width / 2} ${element.y + element.height / 2})"/>\n`;
        break;
      case "line":
      case "arrow":
        if ("points" in element && element.points.length > 1) {
          const pathData = element.points
            .map((p, i) => `${i === 0 ? "M" : "L"} ${element.x + p.x} ${element.y + p.y}`)
            .join(" ");
          svg += `  <path d="${pathData}" fill="none" stroke="${element.strokeColor}" 
          stroke-width="${element.strokeWidth}" opacity="${element.opacity}"/>\n`;
        }
        break;
      case "freedraw":
        if ("points" in element && element.points.length > 1) {
          const pathData = element.points
            .map((p, i) => `${i === 0 ? "M" : "L"} ${element.x + p.x} ${element.y + p.y}`)
            .join(" ");
          svg += `  <path d="${pathData}" fill="none" stroke="${element.strokeColor}" 
          stroke-width="${element.strokeWidth}" opacity="${element.opacity}"/>\n`;
        }
        break;
      case "text":
        if ("text" in element) {
          svg += `  <text x="${element.x}" y="${element.y + (element.fontSize || 16)}" 
          font-family="${element.fontFamily || "Arial"}" font-size="${element.fontSize || 16}" 
          fill="${element.strokeColor}" opacity="${element.opacity}">${escapeXml(element.text)}</text>\n`;
        }
        break;
      case "image":
        if ("src" in element) {
          svg += `  <image x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" 
          href="${element.src}" opacity="${element.opacity}"/>\n`;
        }
        break;
    }
  }

  svg += "</svg>";
  return svg;
}

export function exportToJSON(
  elements: DriplElement[],
  metadata?: Partial<CanvasMetadata>
): string {
  const exportData = {
    version: CANVAS_VERSION,
    metadata: {
      version: CANVAS_VERSION,
      created: metadata?.created || Date.now(),
      modified: Date.now(),
      author: metadata?.author,
      title: metadata?.title,
      description: metadata?.description,
    },
    elements,
  };

  return JSON.stringify(exportData, null, 2);
}

export function importFromJSON(
  json: string
): { elements: DriplElement[]; metadata: CanvasMetadata } {
  const data = JSON.parse(json);

  if (data.version !== CANVAS_VERSION) {
    console.warn(
      `Importing canvas version ${data.version}, current version is ${CANVAS_VERSION}`
    );
    // Future: Add migration logic here
  }

  return {
    elements: data.elements || [],
    metadata: data.metadata || {
      version: data.version || CANVAS_VERSION,
      created: Date.now(),
      modified: Date.now(),
    },
  };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadString(
  content: string,
  filename: string,
  mimeType: string = "text/plain"
): void {
  const blob = new Blob([content], { type: mimeType });
  downloadBlob(blob, filename);
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
