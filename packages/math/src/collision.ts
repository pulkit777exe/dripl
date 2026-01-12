import { DriplElement, Point } from "@dripl/common";
import { isPointInRect } from "./geometry";

export const hitTest = (point: Point, element: DriplElement): boolean => {
  switch (element.type) {
    case "rectangle":
    case "ellipse":
    case "text":
      return isPointInRect(point, {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
      });
    case "arrow":
    case "line":
    case "freedraw":
      // TODO: Implement precise hit testing for linear elements
      return isPointInRect(point, {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
      });
    default:
      return false;
  }
};
