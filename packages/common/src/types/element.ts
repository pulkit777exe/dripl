// import { ShapeType } from "../constants";

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

  // Version tracking for reconciliation (per TDD)
  version?: number; // Incremented on each update for conflict resolution
  versionNonce?: number; // Unique nonce for version updates
  updated?: number; // Timestamp of last update

  // Rough.js properties for sketchy aesthetic
  roughness?: number; // 0-3, default 1
  strokeStyle?: "solid" | "dashed" | "dotted";
  fillStyle?:
    | "hachure"
    | "solid"
    | "zigzag"
    | "cross-hatch"
    | "dots"
    | "dashed"
    | "zigzag-line";
  seed?: number; // For consistent randomness across renders
  angle?: number; // Rotation in radians
  locked?: boolean; // Prevent editing
  groupId?: string; // For grouping elements together
  zIndex?: number; // For element ordering
  rotation?: number; // Rotation in degrees
  flipHorizontal?: number; // -1 or 1
  flipVertical?: number; // -1 or 1

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
  labelId?: string; // ID of text element used as label
  arrowHeads?: {
    start?: boolean;
    end?: boolean;
  };
}

export interface FreeDrawElement extends ElementBase {
  type: "freedraw";
  points: Point[];
  brushSize?: number; // Base brush size
  pressureValues?: number[]; // Pressure values for variable width
  widths?: number[]; // Calculated widths for rendering
}

export interface TextElement extends ElementBase {
  type: "text";
  text: string;
  fontSize: number;
  fontFamily: string;
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  boundElementId?: string; // ID of element this text is bound to
  containerId?: string; // ID of container element (for labeled arrows)
}

export interface ImageElement extends ElementBase {
  type: "image";
  src: string;
}

export interface FrameElement extends ElementBase {
  type: "frame";
  title?: string;
  padding?: number;
}

// Normalized binding model for constraints (Spec §5.3 Binding Constraint System)
export type BindingMode = "inside" | "orbit";

export interface NormalizedBinding {
  /** Target element id this binding attaches to. */
  elementId: string;
  /**
   * Fixed point in the element's local, normalized coordinate system.
   * For frames/rects: [0,0] top-left, [1,1] bottom-right.
   * For linear elements: [0,0] is start, [1,0] is end on normalized axis.
   */
  fixedPoint: Point;
  mode: BindingMode;
}

// Base type for all Dripl elements
export type DriplElement =
  | RectangleElement
  | EllipseElement
  | DiamondElement
  | LinearElement
  | FreeDrawElement
  | TextElement
  | ImageElement
  | FrameElement;

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
