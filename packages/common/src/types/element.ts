import { ShapeType } from "../constants.js";

export interface Point {
  x: number;
  y: number;
}

export interface ElementBase {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor?: string;
  backgroundColor?: string;
  strokeWidth?: number;
  opacity?: number;
  isDeleted?: boolean;

  // Rough.js properties for sketchy aesthetic
  roughness?: number; // 0-3, default 1
  strokeStyle?: "solid" | "dashed" | "dotted";
  fillStyle?: "hachure" | "solid" | "zigzag" | "cross-hatch" | "dots" | "dashed" | "zigzag-line";
  seed?: number; // For consistent randomness across renders
  angle?: number; // Rotation in radians
  locked?: boolean; // Prevent editing
  groupId?: string; // For grouping elements together

  // Custom properties for extensions
  [key: string]: any;
}

export interface RectangleElement extends ElementBase {
  type: "rectangle";
}

export interface EllipseElement extends ElementBase {
  type: "ellipse";
}

export interface DiamondElement extends ElementBase {
  type: "diamond";
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

export interface ImageElement extends ElementBase {
  type: "image";
  src: string;
}

// Base type for all Dripl elements
export type DriplElement =
  | RectangleElement
  | EllipseElement
  | DiamondElement
  | LinearElement
  | FreeDrawElement
  | TextElement
  | ImageElement;

// Shape definition interface for registration
export interface ShapeDefinition<T extends DriplElement = DriplElement> {
  type: string;
  name: string;
  icon?: string; // Use string for icon name instead of React node
  category: string;
  create: (props: Partial<T>) => T;
  validate: (element: any) => boolean;
  render: (ctx: CanvasRenderingContext2D, element: T) => void;
  getProperties: (element: T) => any;
  setProperties: (element: T, properties: any) => T;
}

// Type guard for shape validation
export function isDriplElement(element: any): element is DriplElement {
  return (
    element &&
    typeof element.id === "string" &&
    typeof element.type === "string" &&
    typeof element.x === "number" &&
    typeof element.y === "number" &&
    typeof element.width === "number" &&
    typeof element.height === "number"
  );
}
