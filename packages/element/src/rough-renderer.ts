import rough from "roughjs";
import type { DriplElement } from "@dripl/common";
import { getShapeFromCache, setShapeInCache } from "./shape-cache";

export type RoughCanvas = any;
export type Drawable = any;

const generator = rough.generator();

export function createRoughCanvas(
  canvas: HTMLCanvasElement,
): RoughCanvas | null {
  try {
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
): void {
  for (const el of elements) {
    renderRoughElement(rc, ctx, el);
  }
}
