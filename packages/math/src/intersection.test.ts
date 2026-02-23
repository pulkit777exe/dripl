import { describe, it, expect } from "vitest";
import type { DriplElement } from "@dripl/common";
import {
  getElementBounds,
  isPointInElement,
  elementIntersectsSegment,
} from "./intersection";

describe("math/intersection", () => {
  describe("getElementBounds", () => {
    it("should calculate bounds for a rectangle", () => {
      const rect: DriplElement = {
        id: "1",
        type: "rectangle",
        x: 10,
        y: 10,
        width: 20,
        height: 30,
        strokeWidth: 2,
      };

      const bounds = getElementBounds(rect);
      expect(bounds.x).toBe(9);
      expect(bounds.y).toBe(9);
      expect(bounds.width).toBe(22);
      expect(bounds.height).toBe(32);
    });
  });

  describe("isPointInElement", () => {
    it("should check if a point is inside a rectangle", () => {
      const rect: DriplElement = {
        id: "1",
        type: "rectangle",
        x: 10,
        y: 10,
        width: 20,
        height: 30,
      };

      expect(isPointInElement({ x: 15, y: 15 }, rect)).toBe(true);
      expect(isPointInElement({ x: 5, y: 15 }, rect)).toBe(false);
    });

    it("should check if a point is inside an ellipse", () => {
      const ellipse: DriplElement = {
        id: "1",
        type: "ellipse",
        x: 10,
        y: 10,
        width: 20,
        height: 30,
      };

      // Center of the ellipse
      expect(isPointInElement({ x: 20, y: 25 }, ellipse)).toBe(true);
      // Outside the ellipse
      expect(isPointInElement({ x: 10, y: 10 }, ellipse)).toBe(false);
    });

    it("should check if a point is inside a diamond", () => {
      const diamond: DriplElement = {
        id: "1",
        type: "diamond",
        x: 10,
        y: 10,
        width: 20,
        height: 30,
      };

      expect(isPointInElement({ x: 20, y: 25 }, diamond)).toBe(true);
      expect(isPointInElement({ x: 10, y: 10 }, diamond)).toBe(false);
    });
  });

  describe("elementIntersectsSegment", () => {
    it("should check if a segment intersects an element", () => {
      const rect: DriplElement = {
        id: "1",
        type: "rectangle",
        x: 10,
        y: 10,
        width: 20,
        height: 30,
      };

      const seg1 = { start: { x: 15, y: 15 }, end: { x: 25, y: 25 } };
      const seg2 = { start: { x: 5, y: 5 }, end: { x: 8, y: 8 } };

      expect(elementIntersectsSegment(rect, seg1)).toBe(true);
      expect(elementIntersectsSegment(rect, seg2)).toBe(false);
    });
  });
});
