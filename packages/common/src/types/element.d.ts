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
    version?: number;
    versionNonce?: number;
    updated?: number;
    roughness?: number;
    strokeStyle?: "solid" | "dashed" | "dotted";
    fillStyle?: "hachure" | "solid" | "zigzag" | "cross-hatch" | "dots" | "dashed" | "zigzag-line";
    seed?: number;
    angle?: number;
    locked?: boolean;
    groupId?: string;
    zIndex?: number;
    rotation?: number;
    flipHorizontal?: number;
    flipVertical?: number;
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
    labelId?: string;
    arrowHeads?: {
        start?: boolean;
        end?: boolean;
    };
}
export interface FreeDrawElement extends ElementBase {
    type: "freedraw";
    points: Point[];
    brushSize?: number;
    pressureValues?: number[];
    widths?: number[];
}
export interface TextElement extends ElementBase {
    type: "text";
    text: string;
    fontSize: number;
    fontFamily: string;
    textAlign?: "left" | "center" | "right";
    verticalAlign?: "top" | "middle" | "bottom";
    boundElementId?: string;
    containerId?: string;
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
export type DriplElement = RectangleElement | EllipseElement | DiamondElement | LinearElement | FreeDrawElement | TextElement | ImageElement | FrameElement;
export interface ShapeDefinition<T extends DriplElement = DriplElement> {
    type: string;
    name: string;
    icon?: string;
    category: string;
    create: (props: Partial<T>) => T;
    validate: (element: any) => boolean;
    render: (ctx: CanvasRenderingContext2D, element: T) => void;
    getProperties: (element: T) => any;
    setProperties: (element: T, properties: any) => T;
}
export declare function isDriplElement(element: any): element is DriplElement;
//# sourceMappingURL=element.d.ts.map