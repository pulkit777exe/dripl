export interface MockCanvas2DOptions {
  textWidth?: number;
  fontMetrics?: Record<string, { width: number; height: number }>;
}

export function createMockCanvasContext(options: MockCanvas2DOptions = {}): CanvasRenderingContext2D {
  const { textWidth = 50 } = options;

  const mockContext = {
    font: '',
    measureText: (text: string): TextMetrics => {
      if (options.fontMetrics?.[text]) {
        return {
          width: options.fontMetrics[text].width,
          actualBoundingBoxAscent: options.fontMetrics[text].height,
          actualBoundingBoxDescent: 0,
          actualBoundingBoxLeft: 0,
          actualBoundingBoxRight: 0,
          alphabeticBaseline: 0,
          emHeightAscent: 0,
          emHeightDescent: 0,
          hangingBaseline: 0,
          ideographicBaseline: 0,
        } as TextMetrics;
      }

      const charWidth = textWidth / 10;
      return {
        width: text.length * charWidth,
        actualBoundingBoxAscent: 16,
        actualBoundingBoxDescent: 4,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: text.length * charWidth,
        alphabeticBaseline: 0,
        emHeightAscent: 16,
        emHeightDescent: 4,
        hangingBaseline: 0,
        ideographicBaseline: 0,
      } as TextMetrics;
    },
    fillRect: () => {},
    strokeRect: () => {},
    clearRect: () => {},
    fillText: () => {},
    strokeText: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    ellipse: () => {},
    rect: () => {},
    fill: () => {},
    stroke: () => {},
    clip: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    transform: () => {},
    setTransform: () => {},
    setLineDash: () => {},
    getLineDash: () => [],
    drawImage: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }) as unknown as CanvasGradient,
    createRadialGradient: () => ({ addColorStop: () => {} }) as unknown as CanvasGradient,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    direction: 'inherit',
  } as unknown as CanvasRenderingContext2D;

  return mockContext;
}

export function createMockCanvasElement(): HTMLCanvasElement {
  return {
    getContext: (_contextType: string): CanvasRenderingContext2D | null => {
      return createMockCanvasContext();
    },
    width: 800,
    height: 600,
  } as unknown as HTMLCanvasElement;
}
