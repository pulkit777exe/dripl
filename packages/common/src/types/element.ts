import { ShapeType } from "../constants.js";

export interface Point {
  x: number;
  y: number;
}

export interface ElementBase {
  id: string;
  type: ShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor: string;
  backgroundColor: string;
  strokeWidth: number;
  opacity: number;
  isDeleted?: boolean;
}

export interface RectangleElement extends ElementBase {
  type: "rectangle";
}

export interface EllipseElement extends ElementBase {
  type: "ellipse";
}

export interface LinearElement extends ElementBase {
  type: "arrow" | "line";
  points: Point[];
}

export interface FreeDrawElement extends ElementBase {
  type: "freedraw";
  points: Point[];
}

export interface TextElement extends ElementBase {
  type: "text";
  text: string;
  fontSize: number;
  fontFamily: string;
}

export type DriplElement =
  | RectangleElement
  | EllipseElement
  | LinearElement
  | FreeDrawElement
  | TextElement;
