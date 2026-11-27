import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasStore } from '@/lib/store';
import type { DriplElement } from '@dripl/common';

/**
 * Characterization seam: RoughCanvas -> CanvasLayerUI wiring contract.
 *
 * These tests pin the props/handlers RoughCanvas passes to CanvasLayerUI so a
 * refactor can move composition around without silently changing the contract.
 * Child components below CanvasLayerUI are not exercised here; CanvasLayerUI
 * itself is stubbed to capture its props.
 */

const stubs = vi.hoisted(() => ({
  layerProps: null as Record<string, unknown> | null,
  fitAllToScreen: vi.fn<() => void>(),
  fitElementsToScreen: vi.fn<(ids: string[]) => void>(),
  lockElementsForGesture: vi.fn<(ids: Iterable<string>) => void>(),
  unlockGestureElements: vi.fn<() => void>(),
  unlockElement: vi.fn<(id: string) => void>(),
  broadcastCursor: vi.fn<(x: number, y: number) => void>(),
  collaborators: [] as unknown[],
  isConnected: true,
  connectionMessage: 'Connected',
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
    isConnected: stubs.isConnected,
    connectionMessage: stubs.connectionMessage,
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
vi.mock('@/components/canvas/CanvasLayerUI', () => ({
  CanvasLayerUI: (props: Record<string, unknown>) => {
    stubs.layerProps = props;
    return <div data-testid="canvas-layer-ui" />;
  },
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
    isPanning: false,
    textInput: null,
    draftElement: null,
    eraserPath: [],
    cursorPosition: null,
    marqueeSelection: null,
    pendingEmbed: null,
    shouldCacheIgnoreZoom: false,
    ...extra,
  });
  useCanvasStore.getState().setElements(elements, { skipHistory: true });
}

function renderCanvas(props: { roomSlug?: string | null; isLocalCanvas?: boolean; theme?: 'light' | 'dark'; shareToken?: string | null } = {}) {
  return render(
    <RoughCanvas
      roomSlug={props.roomSlug ?? null}
      isLocalCanvas={props.isLocalCanvas ?? props.roomSlug == null}
      theme={props.theme ?? 'light'}
      shareToken={props.shareToken ?? null}
    />
  );
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  vi.clearAllMocks();
  stubs.layerProps = null;
  stubs.isConnected = true;
  stubs.connectionMessage = 'Connected';
  localStorage.clear();
  seed();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('RoughCanvas -> CanvasLayerUI wiring contract', () => {
  it('passes identity and environment props through', async () => {
    renderCanvas({ roomSlug: 'room-7', isLocalCanvas: false, theme: 'dark', shareToken: 'tok' });
    await screen.findByTestId('canvas-layer-ui');

    expect(stubs.layerProps).toMatchObject({
      roomSlug: 'room-7',
      theme: 'dark',
      isLocalCanvas: false,
      readOnly: false,
    });
  });

  it('passes viewport derived from store pan/zoom and container size', async () => {
    renderCanvas({ roomSlug: 'r' });
    await screen.findByTestId('canvas-layer-ui');

    act(() => {
      useCanvasStore.setState({ zoom: 2, panX: 40, panY: -15 });
    });

    expect(stubs.layerProps!.viewport).toMatchObject({ zoom: 2, x: 40, y: -15 });
  });

  it('passes scene state slices and selection', async () => {
    const a = element('a');
    seed([a], { selectedIds: new Set(['a']), gridEnabled: true, gridSize: 16 });
    renderCanvas({ roomSlug: 'r' });
    await screen.findByTestId('canvas-layer-ui');

    expect(stubs.layerProps!.elements).toEqual([a]);
    expect(stubs.layerProps!.selectedIds).toEqual(new Set(['a']));
    expect(stubs.layerProps!.gridEnabled).toBe(true);
    expect(stubs.layerProps!.gridSize).toBe(16);
  });

  it('computes backgroundColor from canvasBackground or theme variable', async () => {
    renderCanvas({ roomSlug: 'r', theme: 'light' });
    await screen.findByTestId('canvas-layer-ui');
    expect(stubs.layerProps!.backgroundColor).toBe('var(--color-canvas-bg)');

    act(() => {
      useCanvasStore.setState({ canvasBackground: '#123456' });
    });
    // resolveCanvasBackground is called; for a hex override it returns the resolved color.
    // Pin the contract: a non-null canvasBackground does not fall back to theme var.
    expect(stubs.layerProps!.backgroundColor).not.toBe('var(--color-canvas-bg)');
  });

  it('maps activeTool to canvasCursor per tool', async () => {
    renderCanvas({ roomSlug: 'r' });
    await screen.findByTestId('canvas-layer-ui');

    const cases: Array<[string, string]> = [
      ['select', 'default'],
      ['hand', 'grab'],
      ['text', 'text'],
      ['eraser', 'none'],
      ['laser', 'crosshair'],
      ['rectangle', 'crosshair'],
      ['freedraw', 'crosshair'],
    ];

    for (const [tool, cursor] of cases) {
      act(() => {
        useCanvasStore.setState({ activeTool: tool, isPanning: false });
      });
      expect(stubs.layerProps!.canvasCursor).toBe(cursor);
    }

    // Panning overrides tool cursor.
    act(() => {
      useCanvasStore.setState({ activeTool: 'rectangle', isPanning: true });
    });
    expect(stubs.layerProps!.canvasCursor).toBe('grabbing');
  });

  it('passes collaboration/sync state', async () => {
    stubs.collaborators = [{ id: 'u2', x: 1, y: 2 }];
    stubs.isConnected = false;
    stubs.connectionMessage = 'Reconnecting';
    renderCanvas({ roomSlug: 'r' });
    await screen.findByTestId('canvas-layer-ui');

    expect(stubs.layerProps!.collaborators).toEqual([{ id: 'u2', x: 1, y: 2 }]);
    expect(stubs.layerProps!.isConnected).toBe(false);
    expect(stubs.layerProps!.connectionMessage).toBe('Reconnecting');
  });

  it('passes primarySelectedElement as first matching selected element or null', async () => {
    const a = element('a');
    const b = element('b');
    seed([a, b], { selectedIds: new Set(['b']) });
    renderCanvas({ roomSlug: 'r' });
    await screen.findByTestId('canvas-layer-ui');
    expect((stubs.layerProps!.primarySelectedElement as DriplElement).id).toBe('b');

    act(() => {
      useCanvasStore.setState({ selectedIds: new Set<string>() });
    });
    expect(stubs.layerProps!.primarySelectedElement).toBeNull();
  });

  it('wires onUpdateElement to store.updateElement by id', async () => {
    seed([element('a')], { selectedIds: new Set(['a']) });
    renderCanvas({ roomSlug: 'r' });
    await screen.findByTestId('canvas-layer-ui');

    act(() => {
      (stubs.layerProps!.onUpdateElement as (el: DriplElement) => void)(
        { id: 'a', x: 999, type: 'rectangle' } as DriplElement
      );
    });
    expect(useCanvasStore.getState().elementsById.get('a')).toMatchObject({ x: 999 });
  });

  it('wires onDelete to cascade-delete selected ids and clear selection', async () => {
    seed([element('a'), element('b')], { selectedIds: new Set(['a']) });
    renderCanvas({ roomSlug: 'r' });
    await screen.findByTestId('canvas-layer-ui');

    act(() => {
      (stubs.layerProps!.onDelete as () => void)();
    });
    expect(Array.from(useCanvasStore.getState().elementsById.keys())).toEqual(['b']);
    expect(useCanvasStore.getState().selectedIds.size).toBe(0);
  });

  it('wires onBringToFront/onSendToBack to store actions with current selection', async () => {
    seed([element('a'), element('b'), element('c')], { selectedIds: new Set(['a']) });
    renderCanvas({ roomSlug: 'r' });
    await screen.findByTestId('canvas-layer-ui');

    act(() => {
      (stubs.layerProps!.onBringToFront as () => void)();
    });
    expect(useCanvasStore.getState().elements.map(e => e.id)).toEqual(['b', 'c', 'a']);

    act(() => {
      (stubs.layerProps!.onSendToBack as () => void)();
    });
    expect(useCanvasStore.getState().elements.map(e => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('wires clipboard/style callbacks to hooks', async () => {
    renderCanvas({ roomSlug: 'r' });
    await screen.findByTestId('canvas-layer-ui');

    act(() => {
      (stubs.layerProps!.onDuplicate as () => void)();
      (stubs.layerProps!.onCopyStyle as () => void)();
      (stubs.layerProps!.onPasteStyle as () => void)();
    });
    await act(async () => {
      (stubs.layerProps!.onCopy as () => void)();
      (stubs.layerProps!.onPaste as () => void)();
    });

    expect(stubs.duplicateSelection).toHaveBeenCalledTimes(1);
    expect(stubs.copyElementStyle).toHaveBeenCalledTimes(1);
    expect(stubs.pasteElementStyle).toHaveBeenCalledTimes(1);
    expect(stubs.copySelectedToClipboard).toHaveBeenCalledTimes(1);
    expect(stubs.pasteFromClipboard).toHaveBeenCalledTimes(1);
  });

  it('wires onNameSubmit to set userName and localStorage', async () => {
    renderCanvas({ roomSlug: 'r' });
    await screen.findByTestId('canvas-layer-ui');

    act(() => {
      (stubs.layerProps!.onNameSubmit as (name: string) => void)('Ada L');
    });
    expect(localStorage.getItem('dripl_username')).toBe('Ada L');
    expect(stubs.layerProps!.userName).toBe('Ada L');
  });

  it('wires onCloseContextMenu to clear context menu state', async () => {
    renderCanvas({ roomSlug: 'r' });
    await screen.findByTestId('canvas-layer-ui');
    // contextMenuState starts null
    expect(stubs.layerProps!.contextMenuState).toBeNull();
    act(() => {
      (stubs.layerProps!.onCloseContextMenu as () => void)();
    });
    expect(stubs.layerProps!.contextMenuState).toBeNull();
  });
});

describe('RoughCanvas -> CanvasLayerUI interaction/flag wiring', () => {
  it('passes interaction flags, text input, cursor, marquee, eraser path', async () => {
    seed([], {
      isDrawing: true,
      isDragging: true,
      isResizing: true,
      textInput: { id: 't1', x: 1, y: 2, value: 'hi' },
      cursorPosition: { x: 5, y: 6 },
      eraserPath: [{ x: 1, y: 1 }],
      marqueeSelection: { start: { x: 0, y: 0 }, end: { x: 10, y: 10 }, active: true },
      elementLocks: new Map([['e1', 'u2']]),
      userId: 'me',
      shouldCacheIgnoreZoom: true,
    });
    renderCanvas({ roomSlug: 'r' });
    await screen.findByTestId('canvas-layer-ui');

    expect(stubs.layerProps).toMatchObject({
      isDrawing: true,
      isDragging: true,
      isResizing: true,
      textInput: { id: 't1', x: 1, y: 2, value: 'hi' },
      cursorPosition: { x: 5, y: 6 },
      eraserPath: [{ x: 1, y: 1 }],
      marqueeSelection: { start: { x: 0, y: 0 }, end: { x: 10, y: 10 }, active: true },
      userId: 'me',
      shouldCacheIgnoreZoom: true,
    });
    expect((stubs.layerProps!.elementLocks as Map<string, string>).get('e1')).toBe('u2');
  });

  it('passes handler functions for pointer, drag/drop, context menu, resize/rotate, text submit', async () => {
    renderCanvas({ roomSlug: 'r' });
    await screen.findByTestId('canvas-layer-ui');

    for (const key of [
      'onDragOver',
      'onDrop',
      'onContextMenu',
      'onPointerDown',
      'onPointerMove',
      'onPointerUp',
      'onPointerCancel',
      'onResizeStart',
      'onRotateStart',
      'onTextSubmit',
      'onNameSubmit',
      'onUpdateElement',
      'onDuplicate',
      'onDelete',
      'onBringToFront',
      'onSendToBack',
      'onCopy',
      'onPaste',
      'onCopyStyle',
      'onPasteStyle',
      'onCloseContextMenu',
    ]) {
      expect(typeof stubs.layerProps![key]).toBe('function');
    }
  });

  it('passes readOnly through and keeps containerReady boolean', async () => {
    seed([], { readOnly: true });
    renderCanvas({ roomSlug: 'r' });
    await screen.findByTestId('canvas-layer-ui');
    expect(stubs.layerProps!.readOnly).toBe(true);
    expect(typeof stubs.layerProps!.containerReady).toBe('boolean');
  });
});
