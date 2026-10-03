import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { CanvasControls } from '@/components/canvas/CanvasControls';
import { useCanvasStore } from '@/lib/store';
import { DEFAULT_ZOOM_SETTINGS } from '@/utils/zoomUtils';
import type { DriplElement } from '@dripl/common';

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

beforeEach(() => {
  useCanvasStore.setState({
    zoom: 1,
    panX: 0,
    panY: 0,
    past: [],
    future: [],
    readOnly: false,
    marqueeSelectionMode: 'intersecting',
    elements: [],
    elementsById: new Map(),
    selectedIds: new Set<string>(),
    spatialVersion: 0,
    spatialChangedIds: [],
    spatialChangedIdsVersion: 0,
  });
});

describe('CanvasControls zoom', () => {
  it('steps by the shared zoom factor and clamps at both limits', () => {
    render(<CanvasControls />);

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(useCanvasStore.getState().zoom).toBeCloseTo(1 * DEFAULT_ZOOM_SETTINGS.zoomFactor, 10);

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(useCanvasStore.getState().zoom).toBeCloseTo(1, 10);

    act(() => useCanvasStore.setState({ zoom: DEFAULT_ZOOM_SETTINGS.maxZoom }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(useCanvasStore.getState().zoom).toBe(DEFAULT_ZOOM_SETTINGS.maxZoom);

    act(() => useCanvasStore.setState({ zoom: DEFAULT_ZOOM_SETTINGS.minZoom }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(useCanvasStore.getState().zoom).toBe(DEFAULT_ZOOM_SETTINGS.minZoom);
  });

  it('keeps the pan when zooming from the controls', () => {
    act(() => useCanvasStore.setState({ panX: 120, panY: -30 }));
    render(<CanvasControls />);

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));

    const { panX, panY } = useCanvasStore.getState();
    expect(panX).toBe(120);
    expect(panY).toBe(-30);
  });

  it('reports the zoom level as a rounded percentage', () => {
    render(<CanvasControls />);
    expect(screen.getByLabelText('Zoom level')).toHaveTextContent('100%');

    act(() => useCanvasStore.setState({ zoom: 1.234 }));
    expect(screen.getByLabelText('Zoom level')).toHaveTextContent('123%');
  });
});

describe('CanvasControls marquee mode', () => {
  it('toggles between intersecting and contained and reflects the state', () => {
    render(<CanvasControls />);
    const toggle = screen.getByRole('button', { name: /Marquee selection/ });

    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveAccessibleName('Marquee selection: intersecting');

    fireEvent.click(toggle);
    expect(useCanvasStore.getState().marqueeSelectionMode).toBe('contained');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveAccessibleName('Marquee selection: contained');

    fireEvent.click(toggle);
    expect(useCanvasStore.getState().marqueeSelectionMode).toBe('intersecting');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  it('stays available while the canvas is read-only, since selection is not a mutation', () => {
    useCanvasStore.setState({ readOnly: true });
    render(<CanvasControls />);
    expect(screen.getByRole('button', { name: /Marquee selection/ })).not.toBeDisabled();
  });
});

describe('CanvasControls history', () => {
  it('enables undo and redo only when there is something to do', () => {
    render(<CanvasControls />);
    const undo = screen.getByRole('button', { name: 'Undo' });
    const redo = screen.getByRole('button', { name: 'Redo' });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();

    act(() => useCanvasStore.setState({ past: [[rect('a')]] }));
    expect(undo).not.toBeDisabled();
    expect(redo).toBeDisabled();

    act(() => useCanvasStore.setState({ future: [[rect('a')]] }));
    expect(redo).not.toBeDisabled();
  });

  it('undoes and redoes through the store', () => {
    useCanvasStore.getState().setElements([rect('a')], { skipHistory: true });
    useCanvasStore.getState().updateElement('a', { x: 50 });
    render(<CanvasControls />);

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(useCanvasStore.getState().elementsById.get('a')?.x).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(useCanvasStore.getState().elementsById.get('a')?.x).toBe(50);
  });

  it('disables history while read-only, which is the more important guard', () => {
    useCanvasStore.setState({ past: [[rect('a')]], future: [[rect('a')]], readOnly: true });
    render(<CanvasControls />);

    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
  });
});
