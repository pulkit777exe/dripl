import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasStore } from '@/lib/store';
import {
  CanvasContextMenuHost,
  ConnectionStatusBanner,
  EraserCursorRing,
  TextInputOverlay,
} from '@/components/canvas/CanvasOverlays';

/**
 * Characterization: CanvasOverlays rendering conditions.
 *
 * These pin the presentational guard conditions that RoughCanvas/CanvasLayerUI
 * rely on. They are intentionally small and focused on the seam contract.
 */

vi.mock('@/components/canvas/ContextMenu', () => ({
  ContextMenu: (props: Record<string, unknown>) => (
    <div data-testid="context-menu" data-element-id={String((props.element as { id?: string } | null)?.id ?? '')} />
  ),
}));

afterEach(() => {
  cleanup();
});

describe('ConnectionStatusBanner', () => {
  it('renders nothing when there is no room', () => {
    const { container } = render(
      <ConnectionStatusBanner roomSlug={null} isConnected={false} connectionMessage="Offline" readOnly={false} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when connected, message is Connected, and not readOnly', () => {
    const { container } = render(
      <ConnectionStatusBanner roomSlug="room-1" isConnected={true} connectionMessage="Connected" readOnly={false} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders connection message when disconnected in a room', () => {
    render(
      <ConnectionStatusBanner roomSlug="room-1" isConnected={false} connectionMessage="Reconnecting" readOnly={false} />
    );
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting');
  });

  it('renders View only when readOnly even if connected', () => {
    render(
      <ConnectionStatusBanner roomSlug="room-1" isConnected={true} connectionMessage="Connected" readOnly={true} />
    );
    expect(screen.getByRole('status')).toHaveTextContent('View only');
  });
});

describe('TextInputOverlay', () => {
  beforeEach(() => {
    useCanvasStore.setState({ textInput: { id: 't1', x: 0, y: 0 } } as never);
  });

  it('renders nothing when textInput is null', () => {
    const { container } = render(
      <TextInputOverlay textInput={null} readOnly={false} zoom={1} panX={0} panY={0} onSubmit={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when readOnly', () => {
    const { container } = render(
      <TextInputOverlay
        textInput={{ id: 't1', x: 10, y: 20 }}
        readOnly={true}
        zoom={1}
        panX={0}
        panY={0}
        onSubmit={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders textarea positioned by viewport transform when editable', () => {
    render(
      <TextInputOverlay
        textInput={{ id: 't1', x: 10, y: 20, value: 'hello' }}
        readOnly={false}
        zoom={2}
        panX={5}
        panY={7}
        onSubmit={vi.fn()}
      />
    );
    const textarea = screen.getByPlaceholderText('Type text…') as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();
    expect(textarea.style.left).toBe(`${10 * 2 + 5}px`);
    expect(textarea.style.top).toBe(`${20 * 2 + 7}px`);
  });

  it('submits on Enter (without shift) and clears on Escape', () => {
    const onSubmit = vi.fn();
    render(
      <TextInputOverlay
        textInput={{ id: 't1', x: 0, y: 0, value: '' }}
        readOnly={false}
        zoom={1}
        panX={0}
        panY={0}
        onSubmit={onSubmit}
      />
    );
    const textarea = screen.getByPlaceholderText('Type text…');
    fireEvent.change(textarea, { target: { value: 'typed' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(onSubmit).toHaveBeenCalledWith('typed');

    onSubmit.mockClear();
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(useCanvasStore.getState().textInput).toBeNull();
  });
});

describe('EraserCursorRing', () => {
  it('renders nothing when tool is not eraser', () => {
    const { container } = render(
      <EraserCursorRing activeTool="select" cursorPosition={{ x: 1, y: 2 }} zoom={1} panX={0} panY={0} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when cursorPosition is null', () => {
    const { container } = render(
      <EraserCursorRing activeTool="eraser" cursorPosition={null} zoom={1} panX={0} panY={0} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders ring at viewport-transformed position when eraser active', () => {
    const { container } = render(
      <EraserCursorRing activeTool="eraser" cursorPosition={{ x: 10, y: 20 }} zoom={2} panX={5} panY={7} />
    );
    const ring = container.firstElementChild as HTMLElement;
    expect(ring).toBeInTheDocument();
    expect(ring.style.left).toBe(`${10 * 2 + 5 - 20}px`);
    expect(ring.style.top).toBe(`${20 * 2 + 7 - 20}px`);
  });
});

describe('CanvasContextMenuHost', () => {
  const baseProps = {
    contextMenuState: { x: 10, y: 20, elementId: 'a' },
    readOnly: false,
    elements: [{ id: 'a', type: 'rectangle' } as unknown as never],
    onClose: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onBringToFront: vi.fn(),
    onSendToBack: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onCopyStyle: vi.fn(),
    onPasteStyle: vi.fn(),
  };

  it('renders nothing when contextMenuState is null', () => {
    const { container } = render(<CanvasContextMenuHost {...baseProps} contextMenuState={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when readOnly', () => {
    const { container } = render(<CanvasContextMenuHost {...baseProps} readOnly={true} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders ContextMenu when open and editable', async () => {
    render(<CanvasContextMenuHost {...baseProps} />);
    expect(await screen.findByTestId('context-menu')).toBeInTheDocument();
  });
});
