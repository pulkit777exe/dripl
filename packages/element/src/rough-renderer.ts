import rough from "roughjs";
import type { DriplElement } from "@dripl/common";
import { getShapeFromCache, setShapeInCache } from "./shape-cache.js";

// Type for RoughCanvas - using any to avoid module resolution issues
type RoughCanvas = any;
type RoughGenerator = any;
type Drawable = any;

const generator = rough.generator();

export function createRoughCanvas(
  canvas: HTMLCanvasElement
): RoughCanvas | null {
  try {
    return rough.canvas(canvas);
  } catch (error) {
    console.error("Failed to create Rough canvas:", error);
    return null;
  }
}

function generateElementShapes(element: DriplElement): Drawable | Drawable[] {
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
  } = element;

  const options = {
    stroke: strokeColor,
    strokeWidth,
    fill: backgroundColor !== "transparent" ? backgroundColor : undefined,
    fillStyle,
    roughness,
    seed,
    strokeLineDash:
      strokeStyle === "dashed"
        ? [10, 5]
        : strokeStyle === "dotted"
          ? [2, 3]
          : undefined,
  };

  switch (element.type) {
    case "rectangle":
      return generator.rectangle(0, 0, width, height, options);

    case "ellipse":
      return generator.ellipse(width / 2, height / 2, width, height, options);

    case "arrow":
    case "line":
      if ("points" in element && element.points && element.points.length > 1) {
        // For lines/arrows, we need to adjust points relative to element x,y if we translate context
        // But since we are generating shapes to be drawn at x,y (or 0,0 with transform),
        // let's stick to generating path with absolute points or relative.
        // The previous implementation used absolute points `rc.linearPath(points)`.
        // To support caching properly with transforms, we usually normalize points to 0,0 or handle offsets.
        // For simplicity with current renderer structure, let's keep absolute points in the shape for now,
        // as `x` and `y` in LinearElements serve as top-left bounding box which might not be 0,0 of the shape.
        // Actually, for robust caching, we should generate shapes relative to element.x/y.
        // But `element.points` are absolute in our current implementation?
        // Let's check: in `RoughCanvas.tsx` points are absolute canvas coords.
        // So we can just use them directly.

        const points = element.points.map(
          (p) => [p.x, p.y] as [number, number]
        );

        const shapes: Drawable[] = [generator.linearPath(points, options)];

        // Draw arrowhead for arrows (custom logic not part of rough generator usually,
        // but we can make it a rough line/polygon if we want sketchiness,
        // or just draw it manually in render.
        // Existing implementation drew it manually. To cache it, we should make it a rough shape too.
        if (element.type === "arrow" && points.length >= 2) {
          const lastPoint = points[points.length - 1]!;
          const secondLastPoint = points[points.length - 2]!;

          const headLength = 15 + strokeWidth * 2;
          const angle = Math.atan2(
            lastPoint[1] - secondLastPoint[1],
            lastPoint[0] - secondLastPoint[0]
          );

          const p1 = [
            lastPoint[0] - headLength * Math.cos(angle - Math.PI / 6),
            lastPoint[1] - headLength * Math.sin(angle - Math.PI / 6),
          ] as [number, number];

          const p2 = [
            lastPoint[0] - headLength * Math.cos(angle + Math.PI / 6),
            lastPoint[1] - headLength * Math.sin(angle + Math.PI / 6),
          ] as [number, number];

          // Arrowhead as a polygon check
          // options.fill = strokeColor;
          // shapes.push(generator.polygon([lastPoint, p1, p2], { ...options, fill: strokeColor, fillStyle: 'solid' }));

          // Or just lines for sketchy look
          shapes.push(
            generator.line(lastPoint[0], lastPoint[1], p1[0], p1[1], options)
          );
          shapes.push(
            generator.line(lastPoint[0], lastPoint[1], p2[0], p2[1], options)
          );
        }
        return shapes;
      }
      return [];

    case "freedraw":
      if ("points" in element && element.points && element.points.length > 0) {
        const points = element.points.map(
          (p) => [p.x, p.y] as [number, number]
        );
        return generator.curve(points, options);
      }
      return [];

    default:
      return [];
  }
}

export function renderElement(
  rc: RoughCanvas,
  ctx: CanvasRenderingContext2D,
  element: DriplElement
): void {
  const { x, y, width, height, opacity, angle = 0, strokeColor } = element;

  // Save context state
  ctx.save();

  // Apply opacity
  ctx.globalAlpha = opacity;

  // Handle Text and Image separately (not Rough shapes)
  if (element.type === "text") {
    if ("text" in element && "fontSize" in element && "fontFamily" in element) {
      if (angle !== 0) {
        ctx.translate(x + width / 2, y + height / 2);
        ctx.rotate(angle);
        ctx.translate(-(x + width / 2), -(y + height / 2));
      }
      ctx.font = `${element.fontSize}px ${element.fontFamily}`;
      ctx.fillStyle = strokeColor;
      ctx.fillText(element.text, x, y + element.fontSize);
    }
    ctx.restore();
    return;
  }

  if (element.type === "image") {
    if ("src" in element) {
      if (angle !== 0) {
        ctx.translate(x + width / 2, y + height / 2);
        ctx.rotate(angle);
        ctx.translate(-(x + width / 2), -(y + height / 2));
      }
      const img = new Image();
      img.src = element.src;
      if (img.complete) {
        ctx.drawImage(img, x, y, width, height);
      } else {
        img.onload = () => {
          ctx.drawImage(img, x, y, width, height);
        };
      }
    }
    ctx.restore();
    return;
  }

  // Handle Rough.js shapes with caching
  let shape = getShapeFromCache(element);
  if (!shape) {
    shape = generateElementShapes(element);
    setShapeInCache(element, shape);
  }

  // Transformations for shapes
  // Note: For rect/ellipse we generated at 0,0 (relative)
  // For linear/freedraw we generated using absolute points (absolute)

  const isLinear =
    element.type === "arrow" ||
    element.type === "line" ||
    element.type === "freedraw";

  if (angle !== 0) {
    // Rotation center
    // For linear elements, x/y is minX/minY (top-left of bounds)
    const cx = x + width / 2;
    const cy = y + height / 2;

    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.translate(-cx, -cy);
  }

  if (!isLinear) {
    // Rect/Ellipse were generated at 0,0 relative to their position
    // So we translate to their position
    ctx.translate(x, y);
  }

  // Draw
  if (Array.isArray(shape)) {
    shape.forEach((s) => rc.draw(s));
  } else {
    rc.draw(shape);
  }

  // Restore context state
  ctx.restore();
}

export function renderElements(
  rc: RoughCanvas,
  ctx: CanvasRenderingContext2D,
  elements: DriplElement[],
  viewportBounds?: { minX: number; minY: number; maxX: number; maxY: number }
): void {
  elements.forEach((element) => {
    // Skip deleted elements
    if (element.isDeleted) return;

    // Simple viewport culling
    if (viewportBounds) {
      const { x, y, width, height } = element;
      if (
        x + width < viewportBounds.minX ||
        x > viewportBounds.maxX ||
        y + height < viewportBounds.minY ||
        y > viewportBounds.maxY
      ) {
        return;
      }
    }

    renderElement(rc, ctx, element);
  });
}
