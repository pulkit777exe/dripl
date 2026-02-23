import { describe, it, expect } from "vitest";
import {
  distance,
  rotate,
  isPointInRect,
  getBounds,
  boundsIntersect,
  pointInPolygon,
  segmentsIntersect,
  distanceToSegment,
} from "./geometry";

describe("math/geometry", () => {
  describe("distance", () => {
    it("should calculate distance between two points", () => {
      expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
      expect(distance({ x: 1, y: 1 }, { x: 4, y: 5 })).toBe(5);
      expect(distance({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(0);
    });
  });

  describe("rotate", () => {
    it("should rotate a point around a center", () => {
      // Rotate (1, 0) 90 degrees around (0,0)
      const [x, y] = rotate(1, 0, 0, 0, Math.PI / 2);
      expect(x).toBeCloseTo(0);
      expect(y).toBeCloseTo(1);
    });
  });

  describe("isPointInRect", () => {
    it("should check if a point is inside a rectangle", () => {
      const rect = { x: 0, y: 0, width: 10, height: 10 };
      expect(isPointInRect({ x: 5, y: 5 }, rect)).toBe(true);
      expect(isPointInRect({ x: -1, y: 5 }, rect)).toBe(false);
      expect(isPointInRect({ x: 5, y: 11 }, rect)).toBe(false);
    });
  });

  describe("getBounds", () => {
    it("should calculate bounds from points", () => {
      const points = [
        { x: 1, y: 2 },
        { x: 5, y: 3 },
        { x: 3, y: 7 },
      ];
      expect(getBounds(points)).toEqual({
        x: 1,
        y: 2,
        width: 4,
        height: 5,
      });
    });
  });

  describe("boundsIntersect", () => {
    it("should check if two bounds intersect", () => {
      const b1 = { x: 0, y: 0, width: 10, height: 10 };
      const b2 = { x: 5, y: 5, width: 10, height: 10 };
      const b3 = { x: 15, y: 15, width: 10, height: 10 };

      expect(boundsIntersect(b1, b2)).toBe(true);
      expect(boundsIntersect(b1, b3)).toBe(false);
    });
  });

  describe("pointInPolygon", () => {
    it("should check if a point is inside a polygon", () => {
      const polygon = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ];
      expect(pointInPolygon({ x: 5, y: 5 }, polygon)).toBe(true);
      expect(pointInPolygon({ x: 15, y: 5 }, polygon)).toBe(false);
    });
  });

  describe("segmentsIntersect", () => {
    it("should check if two segments intersect", () => {
      const s1 = { start: { x: 0, y: 0 }, end: { x: 10, y: 10 } };
      const s2 = { start: { x: 0, y: 10 }, end: { x: 10, y: 0 } };
      const s3 = { start: { x: 15, y: 0 }, end: { x: 25, y: 10 } };

      expect(segmentsIntersect(s1, s2)).toBe(true);
      expect(segmentsIntersect(s1, s3)).toBe(false);
    });
  });

  describe("distanceToSegment", () => {
    it("should calculate distance from point to segment", () => {
      const segment = { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
      expect(distanceToSegment({ x: 5, y: 5 }, segment)).toBe(5);
      expect(distanceToSegment({ x: 15, y: 5 }, segment)).toBeCloseTo(
        Math.sqrt(25 + 25),
      );
    });
  });
});
