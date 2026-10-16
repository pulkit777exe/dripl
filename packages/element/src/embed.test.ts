import { describe, expect, it, vi } from 'vitest';
import { drawGlobeGlyph } from './embed';

function spyContext() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    ellipse: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    strokeStyle: '',
    lineWidth: 0,
  } as unknown as CanvasRenderingContext2D & {
    save: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    beginPath: ReturnType<typeof vi.fn>;
    arc: ReturnType<typeof vi.fn>;
    ellipse: ReturnType<typeof vi.fn>;
    moveTo: ReturnType<typeof vi.fn>;
    lineTo: ReturnType<typeof vi.fn>;
    stroke: ReturnType<typeof vi.fn>;
  };
}

describe('drawGlobeGlyph', () => {
  it('draws a circle, a meridian and an equator centred on the point', () => {
    const ctx = spyContext();
    drawGlobeGlyph(ctx, 100, 50, 12, '#6B6860');

    expect(ctx.arc).toHaveBeenCalledWith(100, 50, 12, 0, Math.PI * 2);
    expect(ctx.ellipse).toHaveBeenCalledWith(100, 50, 12 * 0.45, 12, 0, 0, Math.PI * 2);
    expect(ctx.moveTo).toHaveBeenCalledWith(88, 50);
    expect(ctx.lineTo).toHaveBeenCalledWith(112, 50);
    // Three strokes: rim, meridian, equator.
    expect(ctx.stroke).toHaveBeenCalledTimes(3);
  });

  it('restores the context it borrowed', () => {
    const ctx = spyContext();
    drawGlobeGlyph(ctx, 0, 0, 10, '#000');
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });
});
