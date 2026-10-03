import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextMenu } from '@/components/canvas/ContextMenu';
import type { DriplElement } from '@dripl/common';

const element = { id: 'a', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 } as DriplElement;

function setup(overrides: Partial<React.ComponentProps<typeof ContextMenu>> = {}) {
  const handlers = {
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
  const utils = render(
    <ContextMenu x={120} y={240} element={element} {...handlers} {...overrides} />
  );
  return { ...utils, handlers };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('ContextMenu', () => {
  it('renders nothing without a target element', () => {
    const { container } = setup({ element: null });
    expect(container).toBeEmptyDOMElement();
  });

  it('positions itself at the given screen point', () => {
    const { container } = setup();
    const menu = container.firstElementChild as HTMLElement;
    expect(menu.style.left).toBe('120px');
    expect(menu.style.top).toBe('240px');
    expect(menu).toHaveAttribute('aria-label', 'Element context menu');
  });

  it('opens on the next frame so the CSS transition can run', () => {
    const { container } = setup();
    const menu = () => container.firstElementChild as HTMLElement;
    expect(menu().className).not.toContain('is-open');

    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(menu().className).toContain('is-open');
  });

  it('offers the core actions and invokes each one', () => {
    const { handlers } = setup();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    expect(handlers.onDuplicate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Bring to Front' }));
    expect(handlers.onBringToFront).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Send to Back' }));
    expect(handlers.onSendToBack).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(handlers.onDelete).toHaveBeenCalledTimes(1);
  });

  it('offers the clipboard and style actions when they are wired', () => {
    const { handlers } = setup();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Paste' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy style' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Paste style' }));

    expect(handlers.onCopy).toHaveBeenCalledTimes(1);
    expect(handlers.onPaste).toHaveBeenCalledTimes(1);
    expect(handlers.onCopyStyle).toHaveBeenCalledTimes(1);
    expect(handlers.onPasteStyle).toHaveBeenCalledTimes(1);
  });

  it('hides the optional items when their handler is absent', () => {
    setup({
      onCopy: undefined,
      onPaste: undefined,
      onCopyStyle: undefined,
      onPasteStyle: undefined,
    });

    expect(screen.queryByRole('menuitem', { name: 'Copy' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Paste' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Copy style' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Paste style' })).not.toBeInTheDocument();
    // The always-available actions survive.
    expect(screen.getByRole('menuitem', { name: 'Duplicate' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('closes after the animation when an action fires', () => {
    const { handlers, container } = setup();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    // Closing is deferred by the dropdown duration, not applied immediately.
    expect(handlers.onClose).not.toHaveBeenCalled();
    expect((container.firstElementChild as HTMLElement).className).toContain('is-closing');

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a click outside', () => {
    const { handlers } = setup();
    const outside = document.createElement('div');
    document.body.appendChild(outside);

    fireEvent.mouseDown(outside);
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on a click inside the menu', () => {
    const { handlers, container } = setup();
    fireEvent.mouseDown(container.firstElementChild as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(handlers.onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    const { handlers } = setup();
    fireEvent.keyDown(document, { key: 'Escape' });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores other keys', () => {
    const { handlers } = setup();
    fireEvent.keyDown(document, { key: 'Enter' });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(handlers.onClose).not.toHaveBeenCalled();
  });

  it('removes its document listeners on unmount', () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    const { unmount, handlers } = setup();
    unmount();

    expect(remove).toHaveBeenCalledWith('mousedown', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function));

    fireEvent.keyDown(document, { key: 'Escape' });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(handlers.onClose).not.toHaveBeenCalled();
  });
});
