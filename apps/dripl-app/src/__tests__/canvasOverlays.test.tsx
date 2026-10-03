import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasStore } from '@/lib/store';
import {
  ConnectionStatusBanner,
  EraserCursorRing,
  TextInputOverlay,
} from '@/components/canvas/CanvasOverlays';

function seeded() {
  useCanvasStore.setState({
    textInput: null,
    cursorPosition: null,
    activeTool: 'select',
    readOnly: false,
  });
}

beforeEach(() => {
  seeded();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ConnectionStatusBanner', () => {
  it('stays hidden for a healthy local canvas', () => {
    const { container } = render(
      <ConnectionStatusBanner
        roomSlug={null}
        isConnected={false}
        connectionMessage="Disconnected"
        readOnly={false}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('stays hidden for a connected room in read-write mode', () => {
    const { container } = render(
      <ConnectionStatusBanner
        roomSlug="my-room"
        isConnected
        connectionMessage="Connected"
        readOnly={false}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('reports the connection message while a room is connecting', () => {
    render(
      <ConnectionStatusBanner
        roomSlug="my-room"
        isConnected={false}
        connectionMessage="Connecting…"
        readOnly={false}
      />
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Connecting…');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('reports read-only even when the socket is healthy', () => {
    render(
      <ConnectionStatusBanner
        roomSlug="my-room"
        isConnected
        connectionMessage="Connected"
        readOnly
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('View only');
  });
});

describe('TextInputOverlay', () => {
  it('places the editor at the world point scaled by zoom and offset by pan', () => {
    render(
      <TextInputOverlay
        textInput={{ x: 100, y: 50, id: 't', value: '' }}
        readOnly={false}
        zoom={2}
        panX={30}
        panY={-10}
        onSubmit={vi.fn()}
      />
    );

    const editor = screen.getByPlaceholderText('Type text…');
    // left = 100 * 2 + 30 = 230; top = 50 * 2 - 10 = 90.
    expect(editor.style.left).toBe('230px');
    expect(editor.style.top).toBe('90px');
    // The caret stays 20 world-px tall regardless of zoom.
    expect(editor.style.fontSize).toBe('40px');
  });

  it('seeds the editor with the existing element text', () => {
    render(
      <TextInputOverlay
        textInput={{ x: 0, y: 0, id: 't', existingElementId: 'text-1', value: 'hello' }}
        readOnly={false}
        zoom={1}
        panX={0}
        panY={0}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText('Type text…')).toHaveValue('hello');
  });

  it('submits on Enter without shift and ignores Shift+Enter', () => {
    const onSubmit = vi.fn();
    render(
      <TextInputOverlay
        textInput={{ x: 0, y: 0, id: 't', value: '' }}
        readOnly={false}
        zoom={1}
        panX={0}
        panY={0}
        onSubmit={onSubmit}
      />
    );
    const editor = screen.getByPlaceholderText('Type text…');

    editor.focus();
    fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('closes the editor on Escape without submitting', () => {
    const onSubmit = vi.fn();
    render(
      <TextInputOverlay
        textInput={{ x: 0, y: 0, id: 't', value: 'draft' }}
        readOnly={false}
        zoom={1}
        panX={0}
        panY={0}
        onSubmit={onSubmit}
      />
    );

    fireEvent.keyDown(screen.getByPlaceholderText('Type text…'), { key: 'Escape' });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(useCanvasStore.getState().textInput).toBeNull();
  });

  it('submits the trimmed content on blur, but not whitespace', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <TextInputOverlay
        textInput={{ x: 0, y: 0, id: 't', value: '' }}
        readOnly={false}
        zoom={1}
        panX={0}
        panY={0}
        onSubmit={onSubmit}
      />
    );

    fireEvent.blur(screen.getByPlaceholderText('Type text…'), { target: { value: '   ' } });
    expect(onSubmit).not.toHaveBeenCalled();

    rerender(
      <TextInputOverlay
        textInput={{ x: 0, y: 0, id: 't', value: '' }}
        readOnly={false}
        zoom={1}
        panX={0}
        panY={0}
        onSubmit={onSubmit}
      />
    );
    fireEvent.blur(screen.getByPlaceholderText('Type text…'), { target: { value: 'done' } });
    expect(onSubmit).toHaveBeenCalledWith('done');
  });

  it('renders nothing without an open editor, or while read-only', () => {
    const { container, rerender } = render(
      <TextInputOverlay
        textInput={null}
        readOnly={false}
        zoom={1}
        panX={0}
        panY={0}
        onSubmit={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();

    rerender(
      <TextInputOverlay
        textInput={{ x: 0, y: 0, id: 't', value: '' }}
        readOnly
        zoom={1}
        panX={0}
        panY={0}
        onSubmit={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('EraserCursorRing', () => {
  it('centres a 40px ring on the transformed cursor point', () => {
    const { container } = render(
      <EraserCursorRing
        activeTool="eraser"
        cursorPosition={{ x: 100, y: 50 }}
        zoom={2}
        panX={20}
        panY={0}
      />
    );

    const ring = container.firstElementChild as HTMLElement;
    // left = 100 * 2 + 20 - 20 = 200; top = 50 * 2 + 0 - 20 = 80.
    expect(ring.style.left).toBe('200px');
    expect(ring.style.top).toBe('80px');
    expect(ring.style.width).toBe('40px');
    expect(ring.style.height).toBe('40px');
    // The ring must never intercept the pointer it is describing.
    expect(ring.className).toContain('pointer-events-none');
  });

  it('renders nothing for another tool or without a cursor', () => {
    const { container, rerender } = render(
      <EraserCursorRing
        activeTool="select"
        cursorPosition={{ x: 1, y: 1 }}
        zoom={1}
        panX={0}
        panY={0}
      />
    );
    expect(container).toBeEmptyDOMElement();

    rerender(
      <EraserCursorRing activeTool="eraser" cursorPosition={null} zoom={1} panX={0} panY={0} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('follows the cursor through store updates', () => {
    const Wrapper = () => {
      const activeTool = useCanvasStore(s => s.activeTool);
      const cursorPosition = useCanvasStore(s => s.cursorPosition);
      const zoom = useCanvasStore(s => s.zoom);
      const panX = useCanvasStore(s => s.panX);
      const panY = useCanvasStore(s => s.panY);
      return (
        <EraserCursorRing
          activeTool={activeTool}
          cursorPosition={cursorPosition}
          zoom={zoom}
          panX={panX}
          panY={panY}
        />
      );
    };

    act(() => {
      useCanvasStore.setState({ activeTool: 'eraser', cursorPosition: { x: 0, y: 0 } });
    });
    const { container } = render(<Wrapper />);
    const ring = () => container.firstElementChild as HTMLElement;

    expect(ring().style.left).toBe('-20px');
    act(() => {
      useCanvasStore.setState({ cursorPosition: { x: 10, y: 10 }, zoom: 3, panX: 5, panY: 5 });
    });
    // 10 * 3 + 5 - 20 = 15.
    expect(ring().style.left).toBe('15px');
    expect(ring().style.top).toBe('15px');
  });
});
