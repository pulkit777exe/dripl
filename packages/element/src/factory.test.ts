import { describe, it, expect } from "vitest";
import { createElement } from "./factory";
import type { DriplElement } from "@dripl/common";

describe("element/factory", () => {
  it("should create a rectangle element", () => {
    const rect = createElement("rectangle", 0, 0, 100, 50);

    expect(rect.type).toBe("rectangle");
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    expect(rect.width).toBe(100);
    expect(rect.height).toBe(50);
  });

  it("should create an ellipse element", () => {
    const ellipse = createElement("ellipse", 10, 20, 80, 60);

    expect(ellipse.type).toBe("ellipse");
    expect(ellipse.x).toBe(10);
    expect(ellipse.y).toBe(20);
    expect(ellipse.width).toBe(80);
    expect(ellipse.height).toBe(60);
  });

  it("should create a text element", () => {
    const text = createElement("text", 50, 50, 100, 50);

    expect(text.type).toBe("text");
    expect(text.x).toBe(50);
    expect(text.y).toBe(50);
    expect(text.text).toBe("Text");
  });

  it("should create an arrow element", () => {
    const arrow = createElement("arrow", 0, 0, 100, 100);

    expect(arrow.type).toBe("arrow");
    expect(arrow.points).toBeDefined();
    expect(arrow.points!.length).toBe(2);
  });
});
