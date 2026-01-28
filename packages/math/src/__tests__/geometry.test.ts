/**
 * Unit tests for @dripl/math package
 * Tests geometry calculations and hit detection
 */

import { describe, it, expect } from "vitest";
import {
  distance,
  getBounds,
  boundsIntersect,
  distanceToSegment,
  pointInPolygon,
} from "../geometry";

describe("geometry", () => {
  describe("distance", () => {
    it("should calculate distance between two points", () => {
      const p1 = { x: 0, y: 0 };
      const p2 = { x: 3, y: 4 };
      expect(distance(p1, p2)).toBe(5);
    });

    it("should return 0 for same point", () => {
      const p = { x: 5, y: 5 };
      expect(distance(p, p)).toBe(0);
    });
  });

  describe("getBounds", () => {
    it("should calculate bounding box for points", () => {
      const points = [
        { x: 0, y: 0 },
        { x: 10, y: 5 },
        { x: 5, y: 10 },
      ];
      const bounds = getBounds(points);
      expect(bounds.x).toBe(0);
      expect(bounds.y).toBe(0);
      expect(bounds.width).toBe(10);
      expect(bounds.height).toBe(10);
    });

    it("should handle single point", () => {
      const points = [{ x: 5, y: 5 }];
      const bounds = getBounds(points);
      expect(bounds.x).toBe(5);
      expect(bounds.y).toBe(5);
      expect(bounds.width).toBe(0);
      expect(bounds.height).toBe(0);
    });
  });

  describe("boundsIntersect", () => {
    it("should detect intersecting bounds", () => {
      const a = { x: 0, y: 0, width: 10, height: 10 };
      const b = { x: 5, y: 5, width: 10, height: 10 };
      expect(boundsIntersect(a, b)).toBe(true);
    });

    it("should detect non-intersecting bounds", () => {
      const a = { x: 0, y: 0, width: 5, height: 5 };
      const b = { x: 10, y: 10, width: 5, height: 5 };
      expect(boundsIntersect(a, b)).toBe(false);
    });

    it("should detect adjacent bounds (touching)", () => {
      const a = { x: 0, y: 0, width: 5, height: 5 };
      const b = { x: 5, y: 0, width: 5, height: 5 };
      expect(boundsIntersect(a, b)).toBe(true);
    });
  });

  describe("distanceToSegment", () => {
    it("should calculate distance to segment", () => {
      const point = { x: 0, y: 5 };
      const segment = { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
      expect(distanceToSegment(point, segment)).toBe(5);
    });

    it("should calculate distance to segment endpoint", () => {
      const point = { x: -5, y: 0 };
      const segment = { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
      expect(distanceToSegment(point, segment)).toBe(5);
    });
  });

  describe("pointInPolygon", () => {
    it("should detect point inside polygon", () => {
      const polygon = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ];
      expect(pointInPolygon({ x: 5, y: 5 }, polygon)).toBe(true);
    });

    it("should detect point outside polygon", () => {
      const polygon = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ];
      expect(pointInPolygon({ x: 15, y: 5 }, polygon)).toBe(false);
    });
  });
});
