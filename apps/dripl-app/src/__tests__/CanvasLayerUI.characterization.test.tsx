import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriplElement } from '@dripl/common';
import type {
  CanvasLayerUIChrome,
  CanvasLayerUICollaboration,
  CanvasLayerUIHandlers,
  CanvasLayerUIInteraction,
  CanvasLayerUIProps,
  CanvasLayerUIScene,
  CanvasLayerUIView,
} from '@/components/canvas/CanvasLayerUI';

/**
 * Characterization seam: CanvasLayerUI presentation/visibility contract.
 *
 * Pins which overlays/panels render under which conditions and what key props
 * are forwarded. Children are stubbed so the tests describe the seam, not
 * child implementation details.
 */

const stubs = vi.hoisted(() => ({
  dualProps: null as Record<string, unknown> | null,
  selectionProps: null as Record<string, unknown> | null,
  bannerProps: null as Record<string, unknown> | null,
  textOverlayProps: null as Record<string, unknown> | null,
  eraserProps: null as Record<string, unknown> | null,
  contextHostProps: null as Record<string, unknown> | null,
  propertiesProps: null as Record<string, unknown> | null,
  welcomeProps: null as Record<string, unknown> | null,
  nameModalProps: null as Record<string, unknown> | null,
}));

vi.mock('@/components/canvas/DualCanvas', () => ({
  default: (props: Record<string, unknown>) => {
    stubs.dualProps = props;
    return <div data-testid="dual-canvas" />;
  },
}));
vi.mock('@/components/canvas/SelectionOverlay', () => ({
  MemoizedSelectionOverlay: (props: Record<string, unknown>) => {
    stubs.selectionProps = props;
    return <div data-testid="selection-overlay" />;
  },
}));
vi.mock('@/components/canvas/RemoteCursors', () => ({
  MemoizedRemoteCursors: () => <div data-testid="remote-cursors" />,
}));
vi.mock('@/components/canvas/LaserCanvas', () => ({
  LaserCanvas: () => <div data-testid="laser-canvas" />,
}));
vi.mock('@/components/canvas/PropertiesPanel', () => ({
  PropertiesPanel: (props: Record<string, unknown>) => {
    stubs.propertiesProps = props;
    return <div data-testid="properties-panel" />;
  },
}));
vi.mock('@/components/canvas/NameInputModal', () => ({
  NameInputModal: (props: Record<string, unknown>) => {
    stubs.nameModalProps = props;
    return <div data-testid="name-input-modal" />;
  },
}));
vi.mock('@/components/canvas/WelcomeScreen', () => ({
  WelcomeScreen: (props: Record<string, unknown>) => {
    stubs.welcomeProps = props;
    return <div data-testid="welcome-screen" />;
  },
}));
vi.mock('@/components/canvas/CanvasOverlays', () => ({
  ConnectionStatusBanner: (props: Record<string, unknown>) => {
    stubs.bannerProps = props;
    return <div data-testid="connection-banner" />;
  },
  TextInputOverlay: (props: Record<string, unknown>) => {
    stubs.textOverlayProps = props;
    return <div data-testid="text-input-overlay" />;
  },
  EraserCursorRing: (props: Record<string, unknown>) => {
    stubs.eraserProps = props;
    return <div data-testid="eraser-ring" />;
  },
  CanvasContextMenuHost: (props: Record<string, unknown>) => {
    stubs.contextHostProps = props;
    return <div data-testid="context-menu-host" />;
  },
}));

import { CanvasLayerUI } from '@/components/canvas/CanvasLayerUI';

function element(id: string, extra: Record<string, unknown> = {}): DriplElement {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    strokeColor: '#000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
    ...extra,
  } as unknown as DriplElement;
}

type CanvasLayerUIOverrides = {
  scene?: Partial<CanvasLayerUIScene>;
  view?: Partial<CanvasLayerUIView>;
  interaction?: Partial<CanvasLayerUIInteraction>;
  collaboration?: Partial<CanvasLayerUICollaboration>;
  ui?: Partial<CanvasLayerUIChrome>;
  handlers?: Partial<CanvasLayerUIHandlers>;
};

function makeProps(overrides: CanvasLayerUIOverrides = {}): CanvasLayerUIProps {
  const container = document.createElement('div');
  return {
    scene: {
      elements: [],
      visibleElements: [],
      selectedIds: new Set<string>(),
      draftElement: null,
      eraserPath: [],
      ...overrides.scene,
    },
    view: {
      viewport: { x: 0, y: 0, width: 800, height: 600, zoom: 1 },
      theme: 'light',
      backgroundColor: 'var(--color-canvas-bg)',
      gridEnabled: false,
      gridSize: 20,
      shouldCacheIgnoreZoom: false,
      canvasCursor: 'default',
      activeTool: 'select',
      ...overrides.view,
    },
    interaction: {
      isDrawing: false,
      isDragging: false,
      isResizing: false,
      marqueeSelection: null,
      cursorPosition: null,
      hoveredBindingId: null,
      startPointBindingId: null,
      textInput: null,
      ...overrides.interaction,
    },
    collaboration: {
      roomSlug: null,
      isLocalCanvas: true,
      collaborators: [],
      elementLocks: new Map(),
      userId: 'me',
      userName: 'Ada',
      isConnected: true,
      connectionMessage: 'Connected',
      readOnly: false,
      ...overrides.collaboration,
    },
    ui: {
      containerRef: { current: container } as React.RefObject<HTMLDivElement>,
      containerReady: true,
      contextMenuState: null,
      primarySelectedElement: null,
      ...overrides.ui,
    },
    handlers: {
      setContainerRef: vi.fn(),
      onDragOver: vi.fn(),
      onDrop: vi.fn(),
      onContextMenu: vi.fn(),
      onPointerDown: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
      onPointerCancel: vi.fn(),
      onResizeStart: vi.fn(),
      onRotateStart: vi.fn(),
      onTextSubmit: vi.fn(),
      onNameSubmit: vi.fn(),
      onUpdateElement: vi.fn(),
      onDuplicate: vi.fn(),
      onDelete: vi.fn(),
      onBringToFront: vi.fn(),
      onSendToBack: vi.fn(),
      onCopy: vi.fn(),
      onPaste: vi.fn(),
      onCopyStyle: vi.fn(),
      onPasteStyle: vi.fn(),
      onCloseContextMenu: vi.fn(),
      ...overrides.handlers,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  stubs.dualProps = null;
  stubs.selectionProps = null;
  stubs.bannerProps = null;
  stubs.textOverlayProps = null;
  stubs.eraserProps = null;
  stubs.contextHostProps = null;
  stubs.propertiesProps = null;
  stubs.welcomeProps = null;
  stubs.nameModalProps = null;
});

afterEach(() => {
  cleanup();
});

describe('CanvasLayerUI visibility contract', () => {
  it('renders DualCanvas only when containerReady', () => {
    const { rerender } = render(<CanvasLayerUI {...makeProps({ ui: { containerReady: false } })} />);
    expect(screen.queryByTestId('dual-canvas')).not.toBeInTheDocument();

    rerender(<CanvasLayerUI {...makeProps({ ui: { containerReady: true } })} />);
    expect(screen.getByTestId('dual-canvas')).toBeInTheDocument();
  });

  it('renders SelectionOverlay only when not readOnly', () => {
    render(<CanvasLayerUI {...makeProps({ collaboration: { readOnly: false } })} />);
    expect(screen.getByTestId('selection-overlay')).toBeInTheDocument();
    cleanup();

    render(<CanvasLayerUI {...makeProps({ collaboration: { readOnly: true } })} />);
    expect(screen.queryByTestId('selection-overlay')).not.toBeInTheDocument();
  });

  it('shows WelcomeScreen on empty local canvas and hides after dismiss', async () => {
    render(
      <CanvasLayerUI
        {...makeProps({
          collaboration: { isLocalCanvas: true, roomSlug: null },
          scene: { elements: [] },
        })}
      />
    );
    expect(await screen.findByTestId('welcome-screen')).toBeInTheDocument();

    act(() => {
      (stubs.welcomeProps!.onClose as () => void)();
    });
    expect(screen.queryByTestId('welcome-screen')).not.toBeInTheDocument();
  });

  it('does not show WelcomeScreen when not local, or has elements, or dismissed state irrelevant', async () => {
    const { rerender } = render(
      <CanvasLayerUI
        {...makeProps({
          collaboration: { isLocalCanvas: false, roomSlug: null },
          scene: { elements: [] },
        })}
      />
    );
    await act(async () => {});
    expect(screen.queryByTestId('welcome-screen')).not.toBeInTheDocument();

    rerender(
      <CanvasLayerUI
        {...makeProps({
          collaboration: { isLocalCanvas: true },
          scene: { elements: [element('a')] },
        })}
      />
    );
    await act(async () => {});
    expect(screen.queryByTestId('welcome-screen')).not.toBeInTheDocument();
  });

  it('shows NameInputModal when roomSlug is set and userName is null', async () => {
    render(<CanvasLayerUI {...makeProps({ collaboration: { roomSlug: 'room-1', userName: null } })} />);
    expect(await screen.findByTestId('name-input-modal')).toBeInTheDocument();
  });

  it('does not show NameInputModal for local canvas or when userName exists', async () => {
    render(<CanvasLayerUI {...makeProps({ collaboration: { roomSlug: null, userName: null } })} />);
    await act(async () => {});
    expect(screen.queryByTestId('name-input-modal')).not.toBeInTheDocument();
    cleanup();

    render(<CanvasLayerUI {...makeProps({ collaboration: { roomSlug: 'room-1', userName: 'Ada' } })} />);
    await act(async () => {});
    expect(screen.queryByTestId('name-input-modal')).not.toBeInTheDocument();
  });

  it('shows PropertiesPanel only for select tool, selection, not readOnly', async () => {
    const selected = element('a');
    render(
      <CanvasLayerUI
        {...makeProps({
          view: { activeTool: 'select' },
          scene: { selectedIds: new Set(['a']) },
          collaboration: { readOnly: false },
          ui: { primarySelectedElement: selected },
        })}
      />
    );
    expect(await screen.findByTestId('properties-panel')).toBeInTheDocument();
  });

  it('hides PropertiesPanel when tool is not select, or no selection, or readOnly', async () => {
    const base = makeProps({
      view: { activeTool: 'select' },
      scene: { selectedIds: new Set(['a']) },
      ui: { primarySelectedElement: element('a') },
      collaboration: { readOnly: false },
    });
    const { rerender } = render(
      <CanvasLayerUI {...{ ...base, view: { ...base.view, activeTool: 'rectangle' } }} />
    );
    await act(async () => {});
    expect(screen.queryByTestId('properties-panel')).not.toBeInTheDocument();

    rerender(<CanvasLayerUI {...{ ...base, scene: { ...base.scene, selectedIds: new Set() } }} />);
    await act(async () => {});
    expect(screen.queryByTestId('properties-panel')).not.toBeInTheDocument();

    rerender(
      <CanvasLayerUI {...{ ...base, collaboration: { ...base.collaboration, readOnly: true } }} />
    );
    await act(async () => {});
    expect(screen.queryByTestId('properties-panel')).not.toBeInTheDocument();
  });

  it('always renders ConnectionStatusBanner, TextInputOverlay, EraserCursorRing, CanvasContextMenuHost hosts', () => {
    render(<CanvasLayerUI {...makeProps()} />);
    expect(screen.getByTestId('connection-banner')).toBeInTheDocument();
    expect(screen.getByTestId('text-input-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('eraser-ring')).toBeInTheDocument();
    expect(screen.getByTestId('context-menu-host')).toBeInTheDocument();
  });
});

describe('CanvasLayerUI prop forwarding', () => {
  it('forwards scene/viewport/tool state to DualCanvas and computes preservePointerSamples', () => {
    const els = [element('a')];
    render(
      <CanvasLayerUI
        {...makeProps({
          scene: { elements: els, visibleElements: els, selectedIds: new Set(['a']) },
          view: {
            activeTool: 'freedraw',
            viewport: { x: 1, y: 2, width: 300, height: 200, zoom: 1.5 },
            gridEnabled: true,
            gridSize: 10,
            canvasCursor: 'crosshair',
          },
        })}
      />
    );

    expect(stubs.dualProps).toMatchObject({
      elements: els,
      visibleElements: els,
      selectedIds: new Set(['a']),
      viewport: { x: 1, y: 2, width: 300, height: 200, zoom: 1.5 },
      gridEnabled: true,
      gridSize: 10,
      cursor: 'crosshair',
      preservePointerSamples: true,
    });

    cleanup();
    render(<CanvasLayerUI {...makeProps({ view: { activeTool: 'select' } })} />);
    expect(stubs.dualProps!.preservePointerSamples).toBe(false);

    cleanup();
    render(<CanvasLayerUI {...makeProps({ view: { activeTool: 'eraser' } })} />);
    expect(stubs.dualProps!.preservePointerSamples).toBe(true);
  });

  it('forwards pointer/resize/rotate handlers to DualCanvas and SelectionOverlay', () => {
    const onPointerDown = vi.fn();
    const onPointerMove = vi.fn();
    const onPointerUp = vi.fn();
    const onPointerCancel = vi.fn();
    const onResizeStart = vi.fn();
    const onRotateStart = vi.fn();
    render(
      <CanvasLayerUI
        {...makeProps({
          handlers: {
            onPointerDown,
            onPointerMove,
            onPointerUp,
            onPointerCancel,
            onResizeStart,
            onRotateStart,
          },
        })}
      />
    );

    expect(stubs.dualProps!.onPointerDown).toBe(onPointerDown);
    expect(stubs.dualProps!.onPointerMove).toBe(onPointerMove);
    expect(stubs.dualProps!.onPointerUp).toBe(onPointerUp);
    expect(stubs.dualProps!.onPointerCancel).toBe(onPointerCancel);
    expect(stubs.selectionProps!.onResizeStart).toBe(onResizeStart);
    expect(stubs.selectionProps!.onRotateStart).toBe(onRotateStart);
  });

  it('forwards overlay-specific props', () => {
    const textInput = { id: 't', x: 1, y: 2, value: 'hi' };
    const cursorPosition = { x: 9, y: 8 };
    const contextMenuState = { x: 10, y: 20, elementId: 'a' };
    render(
      <CanvasLayerUI
        {...makeProps({
          collaboration: {
            roomSlug: 'room-1',
            isConnected: false,
            connectionMessage: 'Reconnecting',
            readOnly: false,
          },
          interaction: { textInput, cursorPosition },
          ui: { contextMenuState },
          view: {
            activeTool: 'eraser',
            viewport: { x: 3, y: 4, width: 800, height: 600, zoom: 2 },
          },
        })}
      />
    );

    expect(stubs.bannerProps).toMatchObject({
      roomSlug: 'room-1',
      isConnected: false,
      connectionMessage: 'Reconnecting',
      readOnly: false,
    });
    expect(stubs.textOverlayProps).toMatchObject({
      textInput,
      readOnly: false,
      zoom: 2,
      panX: 3,
      panY: 4,
    });
    expect(stubs.eraserProps).toMatchObject({
      activeTool: 'eraser',
      cursorPosition,
      zoom: 2,
      panX: 3,
      panY: 4,
    });
    expect(stubs.contextHostProps).toMatchObject({
      contextMenuState,
      readOnly: false,
    });
  });

  it('wires context menu host actions to callbacks', () => {
    const onDuplicate = vi.fn();
    const onDelete = vi.fn();
    const onCloseContextMenu = vi.fn();
    render(
      <CanvasLayerUI
        {...makeProps({
          handlers: { onDuplicate, onDelete, onCloseContextMenu },
          ui: { contextMenuState: { x: 0, y: 0, elementId: 'a' } },
        })}
      />
    );

    expect(stubs.contextHostProps!.onDuplicate).toBe(onDuplicate);
    expect(stubs.contextHostProps!.onDelete).toBe(onDelete);
    expect(stubs.contextHostProps!.onClose).toBe(onCloseContextMenu);
  });
});
