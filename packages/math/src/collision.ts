import { DriplElement, Point } from "@dripl/common";
import { isPointInElement } from "./intersection";

export const hitTest = (point: Point, element: DriplElement): boolean => {
  return isPointInElement(point, element);
};
