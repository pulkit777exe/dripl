export declare const COLORS: {
    primary: string;
    secondary: string;
    selection: string;
    background: string;
};
export declare const SHAPES: {
    readonly RECTANGLE: "rectangle";
    readonly ELLIPSE: "ellipse";
    readonly DIAMOND: "diamond";
    readonly ARROW: "arrow";
    readonly LINE: "line";
    readonly TEXT: "text";
    readonly FREEDRAW: "freedraw";
    readonly IMAGE: "image";
    readonly FRAME: "frame";
};
export type ShapeType = (typeof SHAPES)[keyof typeof SHAPES];
//# sourceMappingURL=constants.d.ts.map