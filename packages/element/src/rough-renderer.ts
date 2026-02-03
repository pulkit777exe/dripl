import rough from "roughjs";
import type { DriplElement } from "@dripl/common";
import { getShapeFromCache, setShapeInCache } from "./shape-cache";

export type RoughCanvas = any;
export type Drawable = any;

const generator = rough.generator();

// Offscreen canvas for performance optimization
let offscreenCanvas: HTMLCanvasElement | null = null;
let offscreenContext: CanvasRenderingContext2D | null = null;
let offscreenRoughCanvas: RoughCanvas | null = null;

export function createRoughCanvas(
  canvas: HTMLCanvasElement,
): RoughCanvas | null {
  try {
    // Create offscreen canvas for performance optimization
    if (!offscreenCanvas) {
      offscreenCanvas = document.createElement("canvas");
      offscreenContext = offscreenCanvas.getContext("2d");
      offscreenRoughCanvas = rough.canvas(offscreenCanvas);
    }
    
    // Ensure offscreen canvas matches size of main canvas
    if (offscreenCanvas && canvas.width !== offscreenCanvas.width || canvas.height !== offscreenCanvas.height) {
      offscreenCanvas.width = canvas.width;
      offscreenCanvas.height = canvas.height;
    }
    
    return rough.canvas(canvas);
  } catch (e) {
    console.error("Failed to create Rough canvas", e);
    return null;
  }
}

function cacheKey(element: DriplElement): string {
  return `${element.id}:${(element as any).version ?? 0}`;
}

function generateShape(element: DriplElement): Drawable | Drawable[] {
  const {
    width,
    height,
    strokeColor,
    backgroundColor,
    strokeWidth,
    roughness = 1,
    strokeStyle = "solid",
    fillStyle = "hachure",
    seed,
    roundness = 0,
  } = element as any;

  const options = {
    stroke: strokeColor,
    strokeWidth,
    roughness,
    fill: backgroundColor !== "transparent" ? backgroundColor : undefined,
    fillStyle,
    seed,
    strokeLineDash:
      strokeStyle === "dashed"
        ? [10, 5]
        : strokeStyle === "dotted"
          ? [2, 3]
          : undefined,
    hachureAngle: 45,
    hachureGap: strokeWidth * 2,
    curveStepCount: 9,
    simplification: 0.5,
    roundness,
  };

  switch (element.type) {
    case "rectangle":
      return generator.rectangle(0, 0, width, height, options);

    case "ellipse":
      return generator.ellipse(width / 2, height / 2, width, height, options);

    case "diamond": {
      const topX = width / 2;
      const topY = 0;
      const rightX = width;
      const rightY = height / 2;
      const bottomX = width / 2;
      const bottomY = height;
      const leftX = 0;
      const leftY = height / 2;
      return generator.polygon(
        [
          [topX, topY],
          [rightX, rightY],
          [bottomX, bottomY],
          [leftX, leftY],
        ],
        options,
      );
    }

    case "line":
    case "arrow":
    case "freedraw": {
      if ("points" in element && element.points.length > 1) {
        const pts = element.points.map(
          (p: any) => [p.x, p.y] as [number, number],
        );
        return generator.linearPath(pts, options);
      }
      return [];
    }

    default:
      return [];
  }
}

export function renderRoughElement(
  rc: RoughCanvas,
  ctx: CanvasRenderingContext2D,
  element: DriplElement,
  elements?: DriplElement[], // Added for label rendering
  theme: "light" | "dark" = "dark", // Added for theme support
): void {
  if (element.isDeleted) return;

  ctx.save();
  ctx.globalAlpha = element.opacity ?? 1;

  const { x, y, width, height, angle = 0 } = element;

  if (angle !== 0) {
    const cx = x + width / 2;
    const cy = y + height / 2;
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.translate(-cx, -cy);
  }

  let shape = getShapeFromCache(element as any);
  if (!shape) {
    shape = generateShape(element);
    setShapeInCache(element as any, shape);
  }
  
  const isLinear =
    element.type === "line" ||
    element.type === "arrow" ||
    element.type === "freedraw";

  // Always translate to element's position
  ctx.translate(x, y);

  // For labeled arrows, we need to create a hole for the label
  if (element.type === "arrow" && (element as any).labelId && elements) {
    const label = elements.find(el => el.id === (element as any).labelId);
    
    if (label && label.type === "text") {
      // Calculate the bounds of the label in the arrow's coordinate system
      const labelBounds = {
        x: label.x - x,
        y: label.y - y,
        width: label.width,
        height: label.height,
      };
      
      // Create a hole in the arrow for the label
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = theme === "dark" ? "#0f0f13" : "#f8f9fa";
      ctx.fillRect(labelBounds.x, labelBounds.y, labelBounds.width, labelBounds.height);
      ctx.restore();
    }
  }

  if (Array.isArray(shape)) {
    shape.forEach((s) => rc.draw(s));
  } else {
    rc.draw(shape);
  }

  ctx.restore();
}

export function renderRoughElements(
  rc: RoughCanvas,
  ctx: CanvasRenderingContext2D,
  elements: DriplElement[],
  theme: "light" | "dark" = "dark",
): void {
  // Use offscreen canvas for rendering if available
  if (offscreenCanvas && offscreenContext && offscreenRoughCanvas) {
    // Clear offscreen canvas
    offscreenContext.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
    
    // Render elements to offscreen canvas
    for (const el of elements) {
      renderRoughElement(offscreenRoughCanvas, offscreenContext, el, elements, theme);
    }
    
    // Copy offscreen canvas to main canvas
    ctx.drawImage(offscreenCanvas, 0, 0);
  } else {
    // Fallback to direct rendering if offscreen canvas not available
    for (const el of elements) {
      renderRoughElement(rc, ctx, el, elements, theme);
    }
  }
}
