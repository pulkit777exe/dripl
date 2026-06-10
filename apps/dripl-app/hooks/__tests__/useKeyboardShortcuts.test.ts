import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';

describe('useKeyboardShortcuts', () => {
  const defaults = {
    activeTool: 'select' as const,
    setActiveTool: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    duplicate: vi.fn(),
    deleteSelected: vi.fn(),
    selectAll: vi.fn(),
    copy: vi.fn(),
    paste: vi.fn(),
    escape: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onResetZoom: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when disabled', () => {
    renderHook(() => useKeyboardShortcuts({ ...defaults, enabled: false }));

    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true });
    window.dispatchEvent(event);

    expect(defaults.undo).not.toHaveBeenCalled();
  });

  it('skips keyboard events in input fields', () => {
    renderHook(() => useKeyboardShortcuts(defaults));

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true });
    input.dispatchEvent(event);

    expect(defaults.undo).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('sets tool on single key press', () => {
    renderHook(() => useKeyboardShortcuts(defaults));

    const event = new KeyboardEvent('keydown', { key: 'r', bubbles: true });
    window.dispatchEvent(event);

    expect(defaults.setActiveTool).toHaveBeenCalledWith('rectangle');
  });

  it('triggers undo on Ctrl+Z', () => {
    renderHook(() => useKeyboardShortcuts(defaults));

    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true });
    window.dispatchEvent(event);

    expect(defaults.undo).toHaveBeenCalled();
  });

  it('triggers redo on Ctrl+Shift+Z', () => {
    renderHook(() => useKeyboardShortcuts(defaults));

    const event = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    });
    window.dispatchEvent(event);

    expect(defaults.redo).toHaveBeenCalled();
  });

  it('triggers delete on Delete key', () => {
    renderHook(() => useKeyboardShortcuts(defaults));

    const event = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true });
    window.dispatchEvent(event);

    expect(defaults.deleteSelected).toHaveBeenCalled();
  });

  it('triggers select all on Ctrl+A', () => {
    renderHook(() => useKeyboardShortcuts(defaults));

    const event = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true });
    window.dispatchEvent(event);

    expect(defaults.selectAll).toHaveBeenCalled();
  });

  it('triggers escape on Escape key', () => {
    renderHook(() => useKeyboardShortcuts(defaults));

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    window.dispatchEvent(event);

    expect(defaults.escape).toHaveBeenCalled();
  });
});
