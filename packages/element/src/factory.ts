import { DriplElement, ShapeType, SHAPES } from "@dripl/common";
import { generateId } from "@dripl/utils";

/**
 * All elements created by this factory include a `version` field.
 * Use `id:version` as a stable cache key so cached shapes survive
 * immutable updates and undo/redo.
 */
import { ElementBase } from "@dripl/common";

function makeBase(
  x: number,
  y: number,
  width: number,
  height: number
): Omit<ElementBase, "type"> {
  return {
    id: generateId(),
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

/**
 * Points returned from this factory are *relative* to element.x/element.y.
 * (i.e. a point {x:0,y:0} sits at element.x,element.y on the canvas).
 * Use this convention consistently across renderer, intersection and history.
 */
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
        type: "rectangle",
      };

    case SHAPES.ELLIPSE:
      return {
        ...base,
        type: "ellipse",
      };

    case SHAPES.TEXT:
      return {
        ...base,
        type: "text",
        text: "Text",
        fontSize: 20,
        fontFamily: "Arial",
      };

    case SHAPES.IMAGE:
      return {
        ...base,
        type: "image",
        src: "",
      };

    case SHAPES.ARROW:
      return {
        ...base,
        type: "arrow",
        points: [
          { x: 0, y: 0 },
          { x: width, y: height },
        ],
      };

    case SHAPES.LINE:
      return {
        ...base,
        type: "line",
        points: [
          { x: 0, y: 0 },
          { x: width, y: height },
        ],
      };

    case SHAPES.FREEDRAW:
      return {
        ...base,
        type: "freedraw",
        points: [],
      };

    default:
      throw new Error(`Unknown shape type: ${type}`);
  }
};

