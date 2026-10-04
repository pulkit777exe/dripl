import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasStore } from '@/lib/store';
import type { DriplElement } from '@dripl/common';

/**
 * `RoughCanvas` — the composition root that decides what the canvas shows and
 * which store mutations its chrome can perform.
 *
 * Every child is stubbed, because what is under test is the wiring: the
 * visibility rule for the properties panel, the delete/arrange callbacks that
 * cascade through the store, and the viewport the renderer is handed. Those
 * are the parts that turn a stale selection or a late room join into a wrong
 * scene, and none of them are visible in a snapshot of the markup.
 */

const stubs = vi.hoisted(() => ({
  fitElementsToScreen: vi.fn<(ids: string[]) => void>(),
  fitAllToScreen: vi.fn<() => void>(),
  dualCanvasProps: null as Record<string, unknown> | null,
  lockElementsForGesture: vi.fn<(ids: Iterable<string>) => void>(),
  unlockGestureElements: vi.fn<() => void>(),
  unlockElement: vi.fn<(id: string) => void>(),
  broadcastCursor: vi.fn<(x: number, y: number) => void>(),
  collaborators: [] as unknown[],
  copySelectedToClipboard: vi.fn<() => Promise<void>>(),
  pasteFromClipboard: vi.fn<() => Promise<void>>(),
  duplicateSelection: vi.fn<() => void>(),
  copyElementStyle: vi.fn<() => void>(),
  pasteElementStyle: vi.fn<() => void>(),
  persist: vi.fn(),
}));

vi.mock('@/app/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/utils/username', () => ({ getOrCreateCollaboratorName: () => 'Test Person' }));
vi.mock('@/hooks/canvas/useCanvasPersistence', () => ({
  useCanvasPersistence: () => stubs.persist(),
}));
vi.mock('@/hooks/canvas/useCanvasSync', () => ({
  useCanvasSync: () => ({
    lockElementsForGesture: stubs.lockElementsForGesture,
    unlockGestureElements: stubs.unlockGestureElements,
    unlockElement: stubs.unlockElement,
    collaborators: stubs.collaborators,
    broadcastCursor: stubs.broadcastCursor,
    isConnected: true,
    connectionMessage: null,
  }),
}));
vi.mock('@/hooks/canvas/useCanvasViewport', () => ({
  useCanvasViewport: () => ({
    fitAllToScreen: stubs.fitAllToScreen,
    fitElementsToScreen: stubs.fitElementsToScreen,
  }),
}));
vi.mock('@/hooks/canvas/useCanvasClipboard', () => ({
  useCanvasClipboard: () => ({
    duplicateSelection: stubs.duplicateSelection,
    copySelectedToClipboard: stubs.copySelectedToClipboard,
    pasteFromClipboard: stubs.pasteFromClipboard,
    findOnCanvas: vi.fn(),
  }),
}));
vi.mock('@/hooks/canvas/useStyleTransfer', () => ({
  useStyleTransfer: () => ({
    copyElementStyle: stubs.copyElementStyle,
    pasteElementStyle: stubs.pasteElementStyle,
  }),
}));
vi.mock('@/components/canvas/DualCanvas', () => ({
  default: (props: Record<string, unknown>) => {
    stubs.dualCanvasProps = props;
    return <div data-testid="dual-canvas" />;
  },
}));
vi.mock('@/components/canvas/SelectionOverlay', () => ({
  MemoizedSelectionOverlay: () => <div data-testid="selection-overlay" />,
}));
vi.mock('@/components/canvas/RemoteCursors', () => ({
  MemoizedRemoteCursors: () => <div data-testid="remote-cursors" />,
}));
vi.mock('@/components/canvas/LaserCanvas', () => ({ LaserCanvas: () => null }));
vi.mock('@/components/canvas/PropertiesPanel', () => ({
  PropertiesPanel: (props: {
    onUpdateElement: (el: DriplElement) => void;
    onDuplicateElement: () => void;
    onDeleteElement: () => void;
  }) => (
    <div data-testid="properties-panel">
      <button
        onClick={() =>
          props.onUpdateElement({ id: 'a', x: 999, type: 'rectangle' } as DriplElement)
        }
      >
        panel-update
      </button>
      <button onClick={props.onDuplicateElement}>panel-duplicate</button>
      <button onClick={props.onDeleteElement}>panel-delete</button>
    </div>
  ),
}));
vi.mock('@/components/canvas/NameInputModal', () => ({
  NameInputModal: ({ onSubmit }: { onSubmit: (name: string) => void }) => (
    <div data-testid="name-input-modal">
      <button onClick={() => onSubmit('Ada L')}>name-submit</button>
    </div>
  ),
}));
vi.mock('@/components/canvas/WelcomeScreen', () => ({
  WelcomeScreen: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="welcome-screen">
      <button onClick={onClose}>welcome-close</button>
    </div>
  ),
}));
vi.mock('@/components/canvas/CanvasOverlays', () => ({
  ConnectionStatusBanner: () => null,
  EraserCursorRing: () => null,
  TextInputOverlay: ({
    textInput,
    onSubmit,
  }: {
    textInput: { id: string } | null;
    onSubmit: (text: string) => void;
  }) =>
    textInput ? (
      <div data-testid="text-input-overlay">
        <button onClick={() => onSubmit('typed')}>text-submit</button>
      </div>
    ) : null,
  CanvasContextMenuHost: (props: Record<string, () => void>) => (
    <div data-testid="context-menu-host">
      {(
        [
          'onClose',
          'onDuplicate',
          'onDelete',
          'onBringToFront',
          'onSendToBack',
          'onCopy',
          'onPaste',
          'onCopyStyle',
          'onPasteStyle',
        ] as const
      ).map(key => (
        <button key={key} onClick={props[key]}>
          {`ctx-${key}`}
        </button>
      ))}
    </div>
  ),
}));

import RoughCanvas from '@/components/canvas/RoughCanvas';

class MockResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function element(id: string, extra: Record<string, unknown> = {}): DriplElement {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
    ...extra,
  } as unknown as DriplElement;
}

function seed(elements: DriplElement[] = [], extra: Record<string, unknown> = {}) {
  useCanvasStore.setState({
    elements: [],
    elementsById: new Map(),
    selectedIds: new Set<string>(),
    past: [],
    future: [],
    spatialVersion: 0,
    spatialChangedIds: [],
    spatialChangedIdsVersion: 0,
    activeTool: 'select',
    readOnly: false,
    zoom: 1,
    panX: 0,
    panY: 0,
    gridEnabled: false,
    gridSize: 20,
    canvasBackground: null,
    elementLocks: new Map<string, string>(),
    userId: 'me',
    isDrawing: false,
    isDragging: false,
    isResizing: false,
    textInput: null,
    draftElement: null,
    eraserPath: [],
    cursorPosition: null,
    marqueeSelection: null,
    pendingEmbed: null,
    ...extra,
  });
  useCanvasStore.getState().setElements(elements, { skipHistory: true });
}

function renderCanvas(props: { roomSlug?: string | null } = {}) {
  return render(<RoughCanvas roomSlug={props.roomSlug ?? null} theme="light" />);
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  vi.clearAllMocks();
  stubs.dualCanvasProps = null;
  localStorage.clear();
  seed();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('canvas composition', () => {
  it('hands the renderer the store viewport and preserves pointer samples only for freehand tools', async () => {
    renderCanvas({ roomSlug: 'room-1' });
    await screen.findByTestId('dual-canvas');

    act(() => {
      useCanvasStore.setState({ zoom: 2, panX: 40, panY: -15 });
    });

    const viewport = stubs.dualCanvasProps!.viewport as {
      zoom: number;
      x: number;
      y: number;
    };
    expect(viewport).toMatchObject({ zoom: 2, x: 40, y: -15 });
    // Freedraw and eraser build their outline from the raw pointer samples, so
    // the cache must not quantise them; every other tool may.
    expect(stubs.dualCanvasProps!.preservePointerSamples).toBe(false);

    act(() => {
      useCanvasStore.setState({ activeTool: 'freedraw' });
    });
    expect(stubs.dualCanvasProps!.preservePointerSamples).toBe(true);

    act(() => {
      useCanvasStore.setState({ activeTool: 'eraser' });
    });
    expect(stubs.dualCanvasProps!.preservePointerSamples).toBe(true);
  });

  it('paints the container with the canvas background, or the theme variable', async () => {
    const { container } = renderCanvas({ roomSlug: 'room-1' });
    await screen.findByTestId('dual-canvas');
    const surface = container.querySelector('.canvas-surface') as HTMLElement;
    // With no override the surface defers to the theme, so a dark-mode user
    // does not get a white canvas behind their drawing.
    expect(surface.style.backgroundColor).toBe('var(--color-canvas-bg)');

    act(() => {
      useCanvasStore.setState({ canvasBackground: '#123456' });
    });
    expect(surface.style.backgroundColor).toBe('rgb(18, 52, 86)');
  });

  it('shows the resize overlay to editors and withholds it from viewers', async () => {
    seed([element('a')], { selectedIds: new Set(['a']) });
    renderCanvas({ roomSlug: 'room-1' });
    expect(await screen.findByTestId('selection-overlay')).toBeInTheDocument();

    // A viewer must not get resize or rotate handles: the gesture handlers
    // they start are only refused later, once the element has moved.
    act(() => {
      useCanvasStore.setState({ readOnly: true });
    });
    expect(screen.queryByTestId('selection-overlay')).not.toBeInTheDocument();
  });

  it('shows the properties panel only for a select-tool selection, and never to a viewer', async () => {
    seed([element('a')]);
    renderCanvas({ roomSlug: 'room-1' });
    await screen.findByTestId('dual-canvas');
    // An element exists but nothing is selected.
    expect(screen.queryByTestId('properties-panel')).not.toBeInTheDocument();

    act(() => {
      useCanvasStore.setState({ selectedIds: new Set(['a']) });
    });
    expect(screen.getByTestId('properties-panel')).toBeInTheDocument();

    // A shape tool in progress must not have the selection sidebar over it.
    act(() => {
      useCanvasStore.setState({ activeTool: 'rectangle' });
    });
    expect(screen.queryByTestId('properties-panel')).not.toBeInTheDocument();

    act(() => {
      useCanvasStore.setState({ activeTool: 'select', readOnly: true });
    });
    expect(screen.queryByTestId('properties-panel')).not.toBeInTheDocument();
  });

  it('cancels the in-progress shape on Escape', async () => {
    renderCanvas({ roomSlug: 'room-1' });
    await screen.findByTestId('dual-canvas');

    act(() => {
      useCanvasStore
        .getState()
        .setDraftElement(
          element('draft', { type: 'rectangle', x: 0, y: 0, width: 40, height: 40 })
        );
      useCanvasStore.getState().setIsDrawing(true);
    });
    expect(useCanvasStore.getState().drawingLifecycle).toBe('drawing');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }));
    });

    const state = useCanvasStore.getState();
    // Escape must abandon the draft in both places it is tracked: the store
    // flag the renderer reads, and the ref the keyboard hook sets.
    expect(state.draftElement).toBeNull();
    expect(state.drawingLifecycle).toBe('idle');
    expect(state.isDrawing).toBe(false);
    // Nothing half-drawn survives as a committed element.
    expect(state.elements).toHaveLength(0);
  });

  it('routes a fit-elements event to the viewport helper', async () => {
    renderCanvas({ roomSlug: 'room-1' });
    await screen.findByTestId('dual-canvas');

    act(() => {
      window.dispatchEvent(
        new CustomEvent('dripl:fit-elements', { detail: { elementIds: ['a', 'b'] } })
      );
    });
    expect(stubs.fitElementsToScreen).toHaveBeenCalledWith(['a', 'b']);

    act(() => {
      window.dispatchEvent(new CustomEvent('dripl:fit-elements', { detail: { elementIds: [] } }));
    });
    expect(stubs.fitElementsToScreen).toHaveBeenCalledTimes(1);

    cleanup();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('dripl:fit-elements', { detail: { elementIds: ['c'] } })
      );
    });
    expect(stubs.fitElementsToScreen).toHaveBeenCalledTimes(1);
  });

  it('offers the welcome screen on an empty local canvas and keeps it dismissed', async () => {
    renderCanvas({ roomSlug: null });
    await screen.findByTestId('welcome-screen');

    act(() => {
      screen.getByRole('button', { name: 'welcome-close' }).click();
    });

    expect(screen.queryByTestId('welcome-screen')).not.toBeInTheDocument();
    // A re-render (a store change, a resize) must not bring it back.
    act(() => {
      useCanvasStore.setState({ zoom: 2 });
    });
    expect(screen.queryByTestId('welcome-screen')).not.toBeInTheDocument();
  });

  it('does not offer the welcome screen once the canvas has content, or in a room', async () => {
    seed([element('a')]);
    const local = renderCanvas({ roomSlug: null });
    await screen.findByTestId('dual-canvas');
    expect(screen.queryByTestId('welcome-screen')).not.toBeInTheDocument();
    cleanup();

    // An empty room join is mid-load, not an empty local canvas: greeting it
    // would flash the onboarding over a scene that is still arriving.
    seed([]);
    renderCanvas({ roomSlug: 'room-1' });
    await screen.findByTestId('dual-canvas');
    expect(screen.queryByTestId('welcome-screen')).not.toBeInTheDocument();
    local.unmount();
  });
});

describe('chrome callbacks', () => {
  it('writes an edited property straight back to the store', async () => {
    seed([element('a')], { selectedIds: new Set(['a']) });
    renderCanvas({ roomSlug: 'room-1' });

    act(() => {
      screen.getByRole('button', { name: 'panel-update' }).click();
    });

    expect(useCanvasStore.getState().elementsById.get('a')).toMatchObject({ x: 999 });
  });

  it('deletes the selection and its cascade from the panel, then clears it', async () => {
    // The label is a child of the arrow: the panel's delete must take it too,
    // or the scene keeps a text element bound to a deleted arrow.
    seed(
      [
        element('ar', {
          type: 'arrow',
          labelId: 'lb',
          points: [
            { x: 0, y: 0 },
            { x: 5, y: 0 },
          ],
        }),
        element('lb', { type: 'text', text: 'go', x: 400, y: 400 }),
        element('keep'),
      ],
      { selectedIds: new Set(['ar']) }
    );
    renderCanvas({ roomSlug: 'room-1' });
    await screen.findByTestId('properties-panel');

    act(() => {
      screen.getByRole('button', { name: 'panel-delete' }).click();
    });

    const state = useCanvasStore.getState();
    expect(Array.from(state.elementsById.keys())).toEqual(['keep']);
    expect(state.selectedIds.size).toBe(0);
  });

  it('commits text from the overlay into a real text element', async () => {
    renderCanvas({ roomSlug: 'room-1' });
    await screen.findByTestId('dual-canvas');

    act(() => {
      useCanvasStore.getState().setTextInput({ x: 30, y: 40, id: 'ti-1', value: '' });
    });

    act(() => {
      screen.getByRole('button', { name: 'text-submit' }).click();
    });

    const created = useCanvasStore.getState().elements[0] as unknown as {
      type: string;
      text: string;
      x: number;
      y: number;
    };
    expect(created).toMatchObject({ type: 'text', text: 'typed', x: 30, y: 40 });
    expect(useCanvasStore.getState().textInput).toBeNull();
  });

  it('orders the scene when the context menu brings an element forward or back', async () => {
    seed([element('a'), element('b'), element('c')]);
    renderCanvas({ roomSlug: 'room-1' });
    await screen.findByTestId('context-menu-host');

    act(() => {
      useCanvasStore.setState({ selectedIds: new Set(['a']) });
    });
    act(() => {
      screen.getByRole('button', { name: 'ctx-onBringToFront' }).click();
    });
    await waitFor(() => {
      expect(useCanvasStore.getState().elements.map(el => el.id)).toEqual(['b', 'c', 'a']);
    });

    act(() => {
      screen.getByRole('button', { name: 'ctx-onSendToBack' }).click();
    });
    await waitFor(() => {
      expect(useCanvasStore.getState().elements.map(el => el.id)).toEqual(['a', 'b', 'c']);
    });
  });

  it('deletes the current selection from the context menu, cascade included', async () => {
    seed(
      [
        element('ar', {
          type: 'arrow',
          labelId: 'lb',
          points: [
            { x: 0, y: 0 },
            { x: 5, y: 0 },
          ],
        }),
        element('lb', { type: 'text', text: 'go', x: 400, y: 400 }),
        element('keep'),
      ],
      { selectedIds: new Set(['ar']) }
    );
    renderCanvas({ roomSlug: 'room-1' });
    await screen.findByTestId('context-menu-host');

    act(() => {
      screen.getByRole('button', { name: 'ctx-onDelete' }).click();
    });

    const state = useCanvasStore.getState();
    expect(Array.from(state.elementsById.keys())).toEqual(['keep']);
    expect(state.selectedIds.size).toBe(0);
  });

  it('delegates the clipboard and style commands to their hooks', async () => {
    seed([element('a')], { selectedIds: new Set(['a']) });
    renderCanvas({ roomSlug: 'room-1' });
    await screen.findByTestId('context-menu-host');

    act(() => {
      screen.getByRole('button', { name: 'ctx-onDuplicate' }).click();
      screen.getByRole('button', { name: 'ctx-onClose' }).click();
    });
    expect(stubs.duplicateSelection).toHaveBeenCalledTimes(1);

    await act(async () => {
      screen.getByRole('button', { name: 'ctx-onCopy' }).click();
      screen.getByRole('button', { name: 'ctx-onPaste' }).click();
    });
    expect(stubs.copySelectedToClipboard).toHaveBeenCalledTimes(1);
    expect(stubs.pasteFromClipboard).toHaveBeenCalledTimes(1);

    act(() => {
      screen.getByRole('button', { name: 'ctx-onCopyStyle' }).click();
      screen.getByRole('button', { name: 'ctx-onPasteStyle' }).click();
    });
    expect(stubs.copyElementStyle).toHaveBeenCalledTimes(1);
    expect(stubs.pasteElementStyle).toHaveBeenCalledTimes(1);
  });
});

describe('viewer posture', () => {
  it('still renders the scene chrome a viewer needs, and no editing panel', async () => {
    seed([element('a')], { readOnly: true, selectedIds: new Set(['a']) });
    renderCanvas({ roomSlug: 'room-1' });

    await screen.findByTestId('dual-canvas');
    expect(screen.getByTestId('context-menu-host')).toBeInTheDocument();
    expect(screen.getByTestId('remote-cursors')).toBeInTheDocument();
    expect(screen.queryByTestId('properties-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('selection-overlay')).not.toBeInTheDocument();
    // No collaboration sockets are opened for a read-only document.
    expect(stubs.lockElementsForGesture).not.toHaveBeenCalled();
  });

  it('refuses a text commit from a viewer', async () => {
    seed([], { readOnly: true });
    renderCanvas({ roomSlug: 'room-1' });
    await screen.findByTestId('dual-canvas');

    act(() => {
      useCanvasStore.getState().setTextInput({ x: 0, y: 0, id: 'ti-1', value: '' });
    });
    act(() => {
      screen.getByRole('button', { name: 'text-submit' }).click();
    });

    expect(useCanvasStore.getState().elements).toHaveLength(0);
    expect(useCanvasStore.getState().textInput).toBeNull();
  });
});
