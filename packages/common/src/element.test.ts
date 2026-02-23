import { describe, it, expect } from "vitest";
import type { DriplElement } from "./types/element";

describe("common/element", () => {
  describe("element types", () => {
    it("should define basic element properties", () => {
      const baseElement: DriplElement = {
        id: "1",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        strokeColor: "#000000",
        strokeWidth: 2,
      };

      expect(baseElement.id).toBeDefined();
      expect(baseElement.type).toBeDefined();
      expect(baseElement.x).toBeDefined();
      expect(baseElement.y).toBeDefined();
      expect(baseElement.width).toBeDefined();
      expect(baseElement.height).toBeDefined();
    });
  });
});
