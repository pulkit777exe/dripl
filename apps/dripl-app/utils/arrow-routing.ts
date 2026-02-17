import type { Point, DriplElement } from "@dripl/common";
import { getElementBounds } from "@dripl/math";
import type { Bounds } from "@dripl/math";

/**
 * Advanced Arrow Routing System
 * Per TDD Section 7: Advanced Arrow System
 */

export type ArrowStyle = "straight" | "curved" | "elbow";
export type ArrowheadType = "triangle" | "dot" | "bar" | "diamond" | "none";

export interface ArrowRoutingOptions {
  style: ArrowStyle;
  curvature?: number; // For curved arrows (0-1)
  startArrowhead?: ArrowheadType;
  endArrowhead?: ArrowheadType;
  snapToShape?: boolean;
  sourceElement?: DriplElement;
  targetElement?: DriplElement;
}

/**
 * Calculate points for a straight arrow
 */
export function calculateStraightPath(
  start: Point,
  end: Point,
): Point[] {
  return [start, end];
}

/**
 * Calculate points for a curved (bezier) arrow
 */
export function calculateCurvedPath(
  start: Point,
  end: Point,
  curvature: number = 0.5,
): Point[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  
  // Calculate control points for quadratic bezier
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  
  // Offset perpendicular to the line
  const length = Math.sqrt(dx * dx + dy * dy);
  const offsetX = -dy / length * length * curvature * 0.25;
  const offsetY = dx / length * length * curvature * 0.25;
  
  const controlPoint: Point = {
    x: midX + offsetX,
    y: midY + offsetY,
  };
  
  return [start, controlPoint, end];
}

/**
 * Calculate points for an elbow (orthogonal) arrow
 * Uses Manhattan distance routing
 */
export function calculateElbowPath(
  start: Point,
  end: Point,
): Point[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  
  // Determine whether to go horizontal first or vertical first
  // based on which distance is longer
  const goHorizontalFirst = Math.abs(dx) > Math.abs(dy);
  
  if (goHorizontalFirst) {
    // Horizontal then vertical
    return [
      start,
      { x: end.x, y: start.y }, // Corner point
      end,
    ];
  } else {
    // Vertical then horizontal
    return [
      start,
      { x: start.x, y: end.y }, // Corner point
      end,
    ];
  }
}

/**
 * Calculate arrow path based on style
 */
export function calculateArrowPath(
  start: Point,
  end: Point,
  options: ArrowRoutingOptions,
): Point[] {
  switch (options.style) {
    case "straight":
      return calculateStraightPath(start, end);
    case "curved":
      return calculateCurvedPath(start, end, options.curvature ?? 0.5);
    case "elbow":
      return calculateElbowPath(start, end);
    default:
      return calculateStraightPath(start, end);
  }
}

/**
 * Get arrowhead points for different arrowhead types
 */
export function getArrowheadPoints(
  tip: Point,
  direction: Point, // Unit vector pointing toward tip
  type: ArrowheadType,
  size: number = 10,
): Point[] {
  switch (type) {
    case "triangle": {
      // Standard triangle arrowhead
      const base = {
        x: tip.x - direction.x * size,
        y: tip.y - direction.y * size,
      };
      const perpX = -direction.y;
      const perpY = direction.x;
      return [
        tip,
        {
          x: base.x + perpX * size * 0.5,
          y: base.y + perpY * size * 0.5,
        },
        {
          x: base.x - perpX * size * 0.5,
          y: base.y - perpY * size * 0.5,
        },
      ];
    }
    
    case "dot": {
      // Dot - return center point (render as circle)
      return [tip];
    }
    
    case "bar": {
      // Bar - perpendicular line at tip
      const perpX = -direction.y;
      const perpY = direction.x;
      return [
        {
          x: tip.x + perpX * size * 0.5,
          y: tip.y + perpY * size * 0.5,
        },
        {
          x: tip.x - perpX * size * 0.5,
          y: tip.y - perpY * size * 0.5,
        },
      ];
    }
    
    case "diamond": {
      // Diamond shape
      const base = {
        x: tip.x - direction.x * size * 0.5,
        y: tip.y - direction.y * size * 0.5,
      };
      const perpX = -direction.y;
      const perpY = direction.x;
      return [
        tip,
        {
          x: base.x + perpX * size * 0.5,
          y: base.y + perpY * size * 0.5,
        },
        {
          x: tip.x - direction.x * size,
          y: tip.y - direction.y * size,
        },
        {
          x: base.x - perpX * size * 0.5,
          y: base.y - perpY * size * 0.5,
        },
      ];
    }
    
    case "none":
    default:
      return [];
  }
}

/**
 * Calculate direction vector from line segment
 */
export function getDirectionVector(
  start: Point,
  end: Point,
): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  
  if (length === 0) {
    return { x: 1, y: 0 };
  }
  
  return {
    x: dx / length,
    y: dy / length,
  };
}

/**
 * Snap arrow endpoint to shape binding
 * Per TDD Section 7.3: Binding System
 */
export function snapToShapeBinding(
  point: Point,
  element: DriplElement,
  threshold: number = 20,
): Point {
  const bounds = getElementBounds(element);
  
  // Calculate anchor points on shape edges
  const anchorPoints: Point[] = [
    { x: bounds.x, y: bounds.y + bounds.height / 2 }, // Left center
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 }, // Right center
    { x: bounds.x + bounds.width / 2, y: bounds.y }, // Top center
    { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height }, // Bottom center
  ];
  
  let closestPoint: Point = point;
  let closestDistance = threshold;
  
  for (const anchor of anchorPoints) {
    const distance = Math.sqrt(
      Math.pow(point.x - anchor.x, 2) + Math.pow(point.y - anchor.y, 2),
    );
    
    if (distance < closestDistance) {
      closestDistance = distance;
      closestPoint = anchor;
    }
  }
  
  return closestPoint;
}

/**
 * Calculate binding information for arrow
 * Per TDD Section 7.3
 */
export interface ArrowBinding {
  elementId: string;
  focus: number; // 0-1, position on element edge
}

export function calculateArrowBinding(
  arrowEnd: Point,
  targetElement: DriplElement,
): ArrowBinding | null {
  const bounds = getElementBounds(targetElement);
  
  // Calculate focus (position on edge as 0-1 value)
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  
  const dx = arrowEnd.x - centerX;
  const dy = arrowEnd.y - centerY;
  
  // Determine which edge the arrow is pointing to
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  
  let focus: number;
  
  if (absDx > absDy) {
    // Pointing to left or right edge
    if (dx > 0) {
      // Right edge
      focus = 0.5 + (dy / bounds.height) * 0.5;
    } else {
      // Left edge
      focus = 0.5 - (dy / bounds.height) * 0.5;
    }
  } else {
    // Pointing to top or bottom edge
    if (dy > 0) {
      // Bottom edge
      focus = 0.5 + (dx / bounds.width) * 0.5;
    } else {
      // Top edge
      focus = 0.5 - (dx / bounds.width) * 0.5;
    }
  }
  
  return {
    elementId: targetElement.id,
    focus: Math.max(0, Math.min(1, focus)),
  };
}

/**
 * Recalculate arrow anchor based on binding when shape moves
 * Per TDD Section 7.3
 */
export function recalculateBinding(
  binding: ArrowBinding,
  element: DriplElement,
): Point {
  const bounds = getElementBounds(element);
  
  // Calculate point on edge based on focus value
  if (binding.focus < 0.25) {
    // Top edge
    return {
      x: bounds.x + binding.focus * 4 * bounds.width,
      y: bounds.y,
    };
  } else if (binding.focus < 0.5) {
    // Right edge
    return {
      x: bounds.x + bounds.width,
      y: bounds.y + (binding.focus - 0.25) * 4 * bounds.height,
    };
  } else if (binding.focus < 0.75) {
    // Bottom edge
    return {
      x: bounds.x + (binding.focus - 0.5) * 4 * bounds.width,
      y: bounds.y + bounds.height,
    };
  } else {
    // Left edge
    return {
      x: bounds.x,
      y: bounds.y + (binding.focus - 0.75) * 4 * bounds.height,
    };
  }
}

export default {
  calculateArrowPath,
  getArrowheadPoints,
  getDirectionVector,
  snapToShapeBinding,
  calculateArrowBinding,
  recalculateBinding,
};
