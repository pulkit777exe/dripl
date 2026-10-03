import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SelectionOverlay, type ResizeHandle } from '@/components/canvas/SelectionOverlay';
import type { DriplElement } from '@dripl/common';

function rect(id: string, x: number, y: number, width = 100, height = 80): DriplElement {
  return {
    id,
    type: 'rectangle',
    x,
    y,
    width,
    height,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    // Zero stroke keeps getElementBounds equal to the declared frame.
    strokeWidth: 0,
    opacity: 1,
    version: 1,
    versionNonce: 1,
  } as DriplElement;
}

function arrow(
  id: string,
  x: number,
  y: number,
  points: Array<{ x: number; y: number }>
): DriplElement {
  return {
    id,
    type: 'arrow',
    x,
    y,
    width: points[points.length - 1]!.x,
    height: points[points.length - 1]!.y,
    points,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    version: 1,
    versionNonce: 1,
  } as unknown as DriplElement;
}

type ResizeStart = ReturnType<typeof vi.fn<(handle: ResizeHandle, e: React.PointerEvent) => void>>;

function renderOverlay(props: {
  elements: DriplElement[];
  selectedIds: string[];
  zoom?: number;
  panX?: number;
  panY?: number;
  onResizeStart?: ResizeStart;
  onRotateStart?: ReturnType<typeof vi.fn<(e: React.PointerEvent) => void>>;
  marqueeSelection?: {
    start: { x: number; y: number };
    end: { x: number; y: number };
    active: boolean;
  } | null;
}) {
  const onResizeStart: ResizeStart = props.onResizeStart ?? vi.fn();
  const onRotateStart = props.onRotateStart ?? vi.fn();
  const utils = render(
    <SelectionOverlay
      zoom={props.zoom ?? 1}
      panX={props.panX ?? 0}
      panY={props.panY ?? 0}
      elements={props.elements}
      selectedIds={new Set(props.selectedIds)}
      onResizeStart={onResizeStart}
      onRotateStart={onRotateStart}
      marqueeSelection={props.marqueeSelection ?? null}
    />
  );
  return { ...utils, onResizeStart, onRotateStart };
}

function handle(node: Element, className: string) {
  return node.querySelector(`.${className}`) as HTMLElement | null;
}

describe('SelectionOverlay visibility', () => {
  it('renders nothing without a selection', () => {
    const { container } = renderOverlay({ elements: [rect('a', 0, 0)], selectedIds: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the selected ids are gone from the scene', () => {
    const { container } = renderOverlay({ elements: [], selectedIds: ['ghost'] });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while a marquee drag is active', () => {
    const { container } = renderOverlay({
      elements: [rect('a', 0, 0)],
      selectedIds: ['a'],
      marqueeSelection: { start: { x: 0, y: 0 }, end: { x: 10, y: 10 }, active: true },
    });
    expect(container).toBeEmptyDOMElement();
  });
});

describe('SelectionOverlay single selection', () => {
  it('centres the frame on the element and scales it by zoom', () => {
    const { container } = renderOverlay({
      elements: [rect('a', 100, 100, 200, 60)],
      selectedIds: ['a'],
      zoom: 2,
      panX: 30,
      panY: 10,
    });

    const frame = container.firstElementChild as HTMLElement;
    // Centre (200, 130) → 200*2+30 = 430, 130*2+10 = 270.
    expect(frame.style.left).toBe('430px');
    expect(frame.style.top).toBe('270px');
    expect(frame.style.width).toBe('400px');
    expect(frame.style.height).toBe('120px');
    expect(frame.style.transform).toBe('translate(-50%, -50%) rotate(0rad)');
  });

  it('applies the element rotation in radians', () => {
    const { container } = renderOverlay({
      elements: [{ ...rect('a', 0, 0, 100, 100), angle: Math.PI / 4 } as DriplElement],
      selectedIds: ['a'],
    });
    const frame = container.firstElementChild as HTMLElement;
    // jsdom normalises the transform string; compare against the same shape the
    // component emits so a dropped or transposed rotate is still caught.
    expect(frame.style.transform).toBe(`translate(-50%, -50%) rotate(${Math.PI / 4}rad)`);
  });

  it('offers four corner handles plus a rotate handle', () => {
    const { container, onResizeStart } = renderOverlay({
      elements: [rect('a', 0, 0)],
      selectedIds: ['a'],
    });

    for (const corner of ['nw-handle', 'ne-handle', 'se-handle', 'sw-handle']) {
      expect(handle(container, corner)).not.toBeNull();
    }
    expect(handle(container, 'dripl-rotate-handle')).not.toBeNull();

    fireEvent.pointerDown(handle(container, 'nw-handle')!);
    expect(onResizeStart).toHaveBeenCalledTimes(1);
    expect(onResizeStart.mock.calls[0]![0]).toBe('nw');

    fireEvent.pointerDown(handle(container, 'se-handle')!);
    expect(onResizeStart.mock.calls[1]![0]).toBe('se');
  });

  it('reports a rotate gesture separately from a resize', () => {
    const { container, onRotateStart, onResizeStart } = renderOverlay({
      elements: [rect('a', 0, 0)],
      selectedIds: ['a'],
    });

    fireEvent.pointerDown(handle(container, 'dripl-rotate-handle')!);

    expect(onRotateStart).toHaveBeenCalledTimes(1);
    expect(onResizeStart).not.toHaveBeenCalled();
  });
});

describe('SelectionOverlay multi selection', () => {
  it('boxes the whole selection and draws a per-element frame', () => {
    const { container } = renderOverlay({
      elements: [rect('a', 0, 0, 100, 50), rect('b', 300, 200, 100, 50)],
      selectedIds: ['a', 'b'],
      zoom: 2,
      panX: 0,
      panY: 0,
    });

    // Two individual frames, then the combined box.
    const frames = Array.from(container.querySelectorAll<HTMLElement>('div[style*="border"]'));
    const box = frames.find(el => el.style.border.includes('dashed'))!;
    expect(box.style.left).toBe('0px');
    expect(box.style.top).toBe('0px');
    expect(box.style.width).toBe('800px');
    expect(box.style.height).toBe('500px');
  });

  it('scales the combined box with zoom and pan', () => {
    const { container } = renderOverlay({
      elements: [rect('a', 100, 100, 100, 50), rect('b', 300, 300, 100, 50)],
      selectedIds: ['a', 'b'],
      zoom: 0.5,
      panX: 20,
      panY: 10,
    });

    const box = Array.from(container.querySelectorAll<HTMLElement>('div[style*="border"]')).find(
      el => el.style.border.includes('dashed')
    )!;
    // minX 100 → 100*0.5+20 = 70; minY 100 → 100*0.5+10 = 60.
    expect(box.style.left).toBe('70px');
    expect(box.style.top).toBe('60px');
    // (400-100) * 0.5 = 150 wide, (350-100) * 0.5 = 125 tall.
    expect(box.style.width).toBe('150px');
    expect(box.style.height).toBe('125px');
  });

  it('still offers a rotate handle for the whole group', () => {
    const { container, onRotateStart } = renderOverlay({
      elements: [rect('a', 0, 0), rect('b', 300, 300)],
      selectedIds: ['a', 'b'],
    });

    expect(handle(container, 'dripl-rotate-handle')).not.toBeNull();
    fireEvent.pointerDown(handle(container, 'dripl-rotate-handle')!);
    expect(onRotateStart).toHaveBeenCalledTimes(1);
  });
});

describe('SelectionOverlay linear elements', () => {
  const line = arrow('arrow-1', 100, 50, [
    { x: 0, y: 0 },
    { x: 50, y: 50 },
    { x: 100, y: 0 },
  ]);

  it('renders a handle per point plus a midpoint insert handle', () => {
    const { container, onResizeStart } = renderOverlay({
      elements: [line],
      selectedIds: ['arrow-1'],
    });

    const endpoints = container.querySelectorAll('.dripl-linear-handle');
    const mids = container.querySelectorAll('.dripl-linear-mid-handle');
    const inserts = container.querySelectorAll('.dripl-linear-insert-handle');
    expect(endpoints).toHaveLength(2);
    expect(mids).toHaveLength(1);
    expect(inserts).toHaveLength(2);

    fireEvent.pointerDown(endpoints[0]!);
    expect(onResizeStart.mock.calls[0]![0]).toBe('arrow-start');
    fireEvent.pointerDown(endpoints[1]!);
    expect(onResizeStart.mock.calls[1]![0]).toBe('arrow-end');
    fireEvent.pointerDown(mids[0]!);
    expect(onResizeStart.mock.calls[2]![0]).toBe('arrow-point-1');
    fireEvent.pointerDown(inserts[0]!);
    expect(onResizeStart.mock.calls[3]![0]).toBe('arrow-insert-1');
    fireEvent.pointerDown(inserts[1]!);
    expect(onResizeStart.mock.calls[4]![0]).toBe('arrow-insert-2');
  });

  it('positions handles relative to the polyline bounding box', () => {
    const { container } = renderOverlay({
      elements: [line],
      selectedIds: ['arrow-1'],
      zoom: 2,
      panX: 0,
      panY: 0,
    });

    // Bounds with a 2px stroke: x 99..201, y 49..101.
    const container_ = container.firstElementChild as HTMLElement;
    expect(container_.style.left).toBe('198px');
    expect(container_.style.top).toBe('98px');
    expect(container_.style.width).toBe('204px');
    expect(container_.style.height).toBe('104px');

    // First point world (100, 50) → (100-99)*2 = 2 from the box left.
    const start = container.querySelector('.dripl-linear-handle') as HTMLElement;
    expect(start.style.left).toBe('-4px');
    expect(start.style.top).toBe('-4px');
  });

  it('renders no handles for a polyline with fewer than two points', () => {
    const stub = arrow('arrow-1', 0, 0, [{ x: 0, y: 0 }]);
    const { container } = renderOverlay({ elements: [stub], selectedIds: ['arrow-1'] });

    expect(container.querySelectorAll('.dripl-linear-handle')).toHaveLength(0);
    expect(container.querySelectorAll('.dripl-linear-insert-handle')).toHaveLength(0);
  });

  it('does not draw a stroke border around a polyline', () => {
    const { container } = renderOverlay({ elements: [line], selectedIds: ['arrow-1'] });
    const container_ = container.firstElementChild as HTMLElement;
    // The single-selection path for a shape sets a 1.5px solid border; the
    // linear path deliberately sets none so only the point handles show.
    expect(container_.style.borderStyle).toBe('');
    expect(container_.style.borderWidth).toBe('');
  });
});
