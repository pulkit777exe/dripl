declare module 'rbush' {
  export interface BBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }

  export default class RBush<T extends BBox = BBox> {
    constructor(maxEntries?: number);
    all(): T[];
    search(bbox: BBox): T[];
    collides(bbox: BBox): boolean;
    load(data: readonly T[]): this;
    insert(item: T): this;
    clear(): this;
    remove(item: T, equalsFn?: (a: T, b: T) => boolean): this;
    toJSON(): unknown;
    fromJSON(data: unknown): this;
  }
}

declare module 'qrcode' {
  export interface QRCodeRenderOptions {
    errorCorrectionLevel?: 'low' | 'medium' | 'quartile' | 'high' | 'L' | 'M' | 'Q' | 'H';
    margin?: number;
    scale?: number;
    width?: number;
    color?: {
      dark?: string;
      light?: string;
    };
  }

  export function toCanvas(
    canvasElement: HTMLCanvasElement,
    text: string,
    options?: QRCodeRenderOptions
  ): Promise<void>;
}
