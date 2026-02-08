import {
  DriplElement,
  FreeDrawElement,
  LinearElement,
  Point,
} from "@dripl/common";
// import { getElementBounds } from "./intersection";

export interface ViewportTransform {
  zoom: number;
  scrollX: number;
  scrollY: number;
}

function applyViewportTransform(
  ctx: CanvasRenderingContext2D,
  { zoom, scrollX, scrollY }: ViewportTransform,
) {
  ctx.setTransform(zoom, 0, 0, zoom, -scrollX * zoom, -scrollY * zoom);
}

export function renderElement2D(
  ctx: CanvasRenderingContext2D,
  element: DriplElement,
): void {
  ctx.save();

  ctx.globalAlpha = element.opacity ?? 1;
  ctx.lineWidth = element.strokeWidth ?? 2;
  ctx.strokeStyle = element.strokeColor ?? "#000000";
  ctx.fillStyle = element.backgroundColor ?? "transparent";

  const { x, y, width, height, angle = 0 } = element;

  if (angle !== 0) {
    const cx = x + width / 2;
    const cy = y + height / 2;
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.translate(-cx, -cy);
  }

  switch (element.type) {
    case "rectangle":
      ctx.fillRect(x, y, width, height);
      ctx.strokeRect(x, y, width, height);
      break;

    case "ellipse":
      ctx.beginPath();
      ctx.ellipse(
        x + width / 2,
        y + height / 2,
        width / 2,
        height / 2,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.stroke();
      break;

    case "text":
      if (
        "text" in element &&
        "fontSize" in element &&
        "fontFamily" in element
      ) {
        ctx.font = `${element.fontSize}px ${element.fontFamily}`;
        ctx.fillStyle = element.strokeColor ?? "#000000";
        ctx.fillText(element.text, x, y + element.fontSize);
      }
      break;

    case "image":
      if ("src" in element) {
        const img = new Image();
        img.src = element.src;
        if (img.complete) {
          ctx.drawImage(img, x, y, width, height);
        } else {
          img.onload = () => ctx.drawImage(img, x, y, width, height);
        }
      }
      break;

    case "line":
    case "arrow":
    case "freedraw": {
      const pts = (element as FreeDrawElement | LinearElement).points || [];
      if (pts.length < 2) break;
      ctx.beginPath();
      ctx.moveTo(x + pts[0]!.x, y + pts[0]!.y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(x + pts[i]!.x, y + pts[i]!.y);
      }
      ctx.stroke();
      break;
    }
  }

  ctx.restore();
}

export function renderElements2D(
  ctx: CanvasRenderingContext2D,
  elements: DriplElement[],
  transform: ViewportTransform,
): void {
  ctx.save();
  applyViewportTransform(ctx, transform);

  for (const el of elements) {
    if (el.isDeleted) continue;
    renderElement2D(ctx, el);
  }

  ctx.restore();
}
