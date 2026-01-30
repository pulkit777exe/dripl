import { DriplElement, ShapeType, SHAPES } from "@dripl/common";
import { generateId } from "@dripl/utils";

import { ElementBase } from "@dripl/common";

function makeBase(
  x: number,
  y: number,
  width: number,
  height: number
): ElementBase {
  return {
    id: generateId(),
    type: "rectangle",
    x,
    y,
    width,
    height,
    strokeColor: "#000000",
    backgroundColor: "transparent",
    strokeWidth: 1,
    opacity: 1,
    roughness: 1,
    strokeStyle: "solid",
    fillStyle: "hachure",
    seed: Math.floor(Math.random() * 2 ** 31),
    angle: 0,
    isDeleted: false,
  };
}

export const createElement = (
  type: ShapeType,
  x: number,
  y: number,
  width = 100,
  height = 100
): DriplElement => {
  const base = makeBase(x, y, width, height);

  switch (type) {
    case SHAPES.RECTANGLE:
      return {
        ...base,
        type: "rectangle" as const,
      };

    case SHAPES.ELLIPSE:
      return {
        ...base,
        type: "ellipse" as const,
      };

    case SHAPES.TEXT:
      return {
        ...base,
        type: "text" as const,
        text: "Text",
        fontSize: 20,
        fontFamily: "Arial",
      };

    case SHAPES.IMAGE:
      return {
        ...base,
        type: "image" as const,
        src: "",
      };

    case SHAPES.ARROW:
      return {
        ...base,
        type: "arrow" as const,
        points: [
          { x: 0, y: 0 },
          { x: width, y: height },
        ],
      };

    case SHAPES.DIAMOND:
      return {
        ...base,
        type: "diamond" as const,
      };

    case SHAPES.LINE:
      return {
        ...base,
        type: "line" as const,
        points: [
          { x: 0, y: 0 },
          { x: width, y: height },
        ],
      };

    case SHAPES.FREEDRAW:
      return {
        ...base,
        type: "freedraw" as const,
        points: [],
      };

    case SHAPES.FRAME:
      return {
        ...base,
        type: "frame" as const,
        title: "Frame",
        padding: 20,
      };

    default:
      throw new Error(`Unknown shape type: ${type}`);
  }
};

