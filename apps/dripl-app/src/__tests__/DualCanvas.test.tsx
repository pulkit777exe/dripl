import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DualCanvas from '@/components/canvas/DualCanvas';
import type { DriplElement } from '@dripl/common';

vi.mock('@/renderer/interactiveScene', () => ({ renderInteractiveScene: vi.fn() }));
vi.mock('@/renderer/staticScene', () => ({ renderStaticScene: vi.fn() }));

function rect(id: string): DriplElement {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    version: 1,
    versionNonce: 1,
  } as DriplElement;
}

class MockResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

function renderDual(overrides: Partial<React.ComponentProps<typeof DualCanvas>> = {}) {
  const container = document.createElement('div');
  Object.defineProperty(container, 'offsetWidth', { configurable: true, value: 800 });
  Object.defineProperty(container, 'offsetHeight', { configurable: true, value: 600 });
  document.body.appendChild(container);

  return render(
    <DualCanvas
      containerRef={{ current: container }}
      elements={[rect('a')]}
      selectedIds={new Set(['a'])}
      draftElement={null}
      eraserPath={[]}
      viewport={{ x: 0, y: 0, width: 800, height: 600, zoom: 1 }}
      {...overrides}
    />
  );
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    {} as CanvasRenderingContext2D
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('DualCanvas layering', () => {
  it('renders a static layer beneath an interactive layer', () => {
    renderDual();
    expect(screen.getByLabelText('Drawing canvas')).toBeInTheDocument();
    const canvases = document.querySelectorAll('canvas');
    expect(canvases.length).toBeGreaterThanOrEqual(2);
  });

  it('makes the whole wrapper transparent to pointer events', () => {
    const { container } = renderDual();
    const wrapper = container.firstElementChild as HTMLElement;
    // Individual layers opt back in; the wrapper itself must not swallow
    // events aimed at the canvas chrome around it.
    expect(wrapper.style.pointerEvents).toBe('none');
  });

  it('sizes both backing stores from the container, not the viewport', () => {
    // The container is 800x600 in this harness; the viewport is deliberately
    // different. Zoom affects the drawn scene, not the surface size.
    renderDual({ viewport: { x: 25, y: -10, width: 640, height: 480, zoom: 1.5 } });

    const canvases = Array.from(document.querySelectorAll<HTMLCanvasElement>('canvas'));
    expect(canvases.length).toBeGreaterThanOrEqual(2);
    for (const canvas of canvases) {
      expect(canvas.width).toBe(800);
      expect(canvas.height).toBe(600);
    }
  });

  it('survives a render error in one layer', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const original = HTMLCanvasElement.prototype.getContext;

    let calls = 0;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement
    ) {
      calls += 1;
      // Blow up on the interactive layer only, after the static one is fine.
      if (calls === 2) throw new Error('interactive layer exploded');
      return original.call(this, '2d') as CanvasRenderingContext2D | null;
    } as never);

    expect(() => renderDual()).not.toThrow();
    errorSpy.mockRestore();
  });
});
