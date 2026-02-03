import type { DriplElement, Point } from "@dripl/common";
import { getBounds } from "@dripl/math";

export interface Binding {
  id: string;
  sourceElementId: string;
  targetElementId: string;
  sourcePoint: Point;
  targetPoint: Point;
  type: "arrow" | "line" | "curve";
  properties: {
    strokeColor: string;
    strokeWidth: number;
    strokeStyle: "solid" | "dashed" | "dotted";
    opacity: number;
  };
}

export function getSnapPoint(
  point: Point,
  elements: DriplElement[],
  snapThreshold: number = 10
): Point | null {
  for (const element of elements) {
    const bounds = getBounds(element.points || [
      { x: element.x, y: element.y },
      { x: element.x + element.width, y: element.y + element.height },
    ]);

    const nearLeft = Math.abs(point.x - bounds.x) < snapThreshold;
    const nearRight = Math.abs(point.x - (bounds.x + bounds.width)) < snapThreshold;
    const nearTop = Math.abs(point.y - bounds.y) < snapThreshold;
    const nearBottom = Math.abs(point.y - (bounds.y + bounds.height)) < snapThreshold;

    if (nearLeft || nearRight || nearTop || nearBottom) {
      let snapX = point.x;
      let snapY = point.y;

      if (nearLeft) snapX = bounds.x;
      if (nearRight) snapX = bounds.x + bounds.width;
      if (nearTop) snapY = bounds.y;
      if (nearBottom) snapY = bounds.y + bounds.height;

      return { x: snapX, y: snapY };
    }
  }

  return null;
}

// Check if an element has any bindings
export function hasBindings(elementId: string, bindings: Binding[]): boolean {
  return bindings.some(
    (binding) => binding.sourceElementId === elementId || binding.targetElementId === elementId
  );
}

// Get all bindings for an element
export function getElementBindings(elementId: string, bindings: Binding[]): Binding[] {
  return bindings.filter(
    (binding) => binding.sourceElementId === elementId || binding.targetElementId === elementId
  );
}

// Update bindings when an element is moved
export function updateBindingsForElement(
  elementId: string,
  dx: number,
  dy: number,
  bindings: Binding[]
): Binding[] {
  return bindings.map((binding) => {
    if (binding.sourceElementId === elementId) {
      return {
        ...binding,
        sourcePoint: {
          x: binding.sourcePoint.x + dx,
          y: binding.sourcePoint.y + dy,
        },
      };
    }
    if (binding.targetElementId === elementId) {
      return {
        ...binding,
        targetPoint: {
          x: binding.targetPoint.x + dx,
          y: binding.targetPoint.y + dy,
        },
      };
    }
    return binding;
  });
}

// Draw bindings
export function drawBindings(
  ctx: CanvasRenderingContext2D,
  bindings: Binding[],
  elements: DriplElement[]
) {
  bindings.forEach((binding) => {
    ctx.save();

    ctx.strokeStyle = binding.properties.strokeColor;
    ctx.lineWidth = binding.properties.strokeWidth;
    ctx.globalAlpha = binding.properties.opacity;

    if (binding.properties.strokeStyle === "dashed") {
      ctx.setLineDash([10, 5]);
    } else if (binding.properties.strokeStyle === "dotted") {
      ctx.setLineDash([2, 3]);
    } else {
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    ctx.moveTo(binding.sourcePoint.x, binding.sourcePoint.y);

    if (binding.type === "curve") {
      // Draw curved binding
      const controlX = (binding.sourcePoint.x + binding.targetPoint.x) / 2;
      const controlY = (binding.sourcePoint.y + binding.targetPoint.y) / 2 - 50;
      ctx.quadraticCurveTo(controlX, controlY, binding.targetPoint.x, binding.targetPoint.y);
    } else {
      // Draw straight line
      ctx.lineTo(binding.targetPoint.x, binding.targetPoint.y);
    }

    ctx.stroke();

    if (binding.type === "arrow") {
      // Draw arrow head
      const dx = binding.targetPoint.x - binding.sourcePoint.x;
      const dy = binding.targetPoint.y - binding.sourcePoint.y;
      const angle = Math.atan2(dy, dx);
      const headLength = 10;

      ctx.beginPath();
      ctx.moveTo(binding.targetPoint.x, binding.targetPoint.y);
      ctx.lineTo(
        binding.targetPoint.x - headLength * Math.cos(angle - Math.PI / 6),
        binding.targetPoint.y - headLength * Math.sin(angle - Math.PI / 6)
      );
      ctx.moveTo(binding.targetPoint.x, binding.targetPoint.y);
      ctx.lineTo(
        binding.targetPoint.x - headLength * Math.cos(angle + Math.PI / 6),
        binding.targetPoint.y - headLength * Math.sin(angle + Math.PI / 6)
      );
      ctx.stroke();
    }

    ctx.restore();
  });
}