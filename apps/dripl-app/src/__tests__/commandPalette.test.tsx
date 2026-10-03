import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasStore } from '@/lib/store';
import { CommandPalette } from '@/components/canvas/CommandPalette';
import type { DriplElement } from '@dripl/common';

const theme = vi.hoisted(() => ({ current: 'light' as 'light' | 'dark', setTheme: vi.fn() }));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: theme.current, setTheme: theme.setTheme }),
}));

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

function open() {
  const utils = render(<CommandPalette />);
  act(() => {
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  });
  return utils;
}

beforeEach(() => {
  theme.current = 'light';
  theme.setTheme.mockClear();
  useCanvasStore.setState({
    zoom: 1,
    gridEnabled: false,
    activeTool: 'select',
    theme: 'light',
    elements: [],
    elementsById: new Map(),
    selectedIds: new Set<string>(),
    past: [],
    future: [],
    spatialVersion: 0,
    spatialChangedIds: [],
    spatialChangedIdsVersion: 0,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CommandPalette visibility', () => {
  it('stays closed until Ctrl/Cmd+K or the open event', () => {
    const { container } = render(<CommandPalette />);
    expect(container).toBeEmptyDOMElement();

    act(() => {
      window.dispatchEvent(new CustomEvent('dripl:open-command-palette'));
    });
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
  });

  it('toggles on Ctrl+K and closes on Escape', () => {
    render(<CommandPalette />);

    act(() => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('toggles closed on a second Ctrl+K', () => {
    render(<CommandPalette />);
    act(() => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    });
    act(() => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('removes its listeners on unmount', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<CommandPalette />);
    unmount();

    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('dripl:open-command-palette', expect.any(Function));

    act(() => {
      window.dispatchEvent(new CustomEvent('dripl:open-command-palette'));
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('CommandPalette filtering', () => {
  it('groups commands under their category headings', () => {
    open();
    expect(screen.getByText('View')).toBeInTheDocument();
    expect(screen.getByText('Tools')).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();
  });

  it('narrows to matching commands and reports an empty result', () => {
    open();
    const search = screen.getByPlaceholderText('Search commands...');

    fireEvent.change(search, { target: { value: 'grid' } });
    expect(screen.getByRole('button', { name: /Show grid/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Zoom in/ })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'zzz-no-match' } });
    expect(screen.getByText(/No commands found for/)).toBeInTheDocument();
  });
});

describe('CommandPalette execution', () => {
  it('performs the clicked command and closes', () => {
    open();

    fireEvent.click(screen.getByRole('button', { name: /Rectangle/ }));

    expect(useCanvasStore.getState().activeTool).toBe('rectangle');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('performs the highlighted command on Enter', () => {
    open();
    const search = screen.getByPlaceholderText('Search commands...');
    fireEvent.change(search, { target: { value: 'zoom in' } });

    fireEvent.keyDown(search, { key: 'Enter' });

    expect(useCanvasStore.getState().zoom).toBeGreaterThan(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does nothing on Enter with no results', () => {
    open();
    const search = screen.getByPlaceholderText('Search commands...');
    fireEvent.change(search, { target: { value: 'zzz-no-match' } });

    fireEvent.keyDown(search, { key: 'Enter' });

    // Nothing performed, and the palette stays open so the query can be fixed.
    expect(screen.queryByRole('dialog')).toBeInTheDocument();
  });

  it('moves the highlight with the arrow keys without wrapping past the ends', () => {
    open();
    const search = screen.getByPlaceholderText('Search commands...');
    fireEvent.change(search, { target: { value: 'zoom' } });

    // Two matches: "Zoom in" and "Reset zoom to 100%".
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });

    // Clamped at the last entry rather than wrapping to the first.
    expect(useCanvasStore.getState().zoom).toBe(1);
  });

  it('resets the highlight to the first entry when the query changes', () => {
    open();
    const search = screen.getByPlaceholderText('Search commands...');

    fireEvent.change(search, { target: { value: 'zoom' } });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'ArrowDown' });

    fireEvent.change(search, { target: { value: 'grid' } });
    fireEvent.keyDown(search, { key: 'Enter' });

    expect(useCanvasStore.getState().gridEnabled).toBe(true);
  });

  it('follows the hover highlight', () => {
    open();
    const search = screen.getByPlaceholderText('Search commands...');
    fireEvent.change(search, { target: { value: 'eraser' } });

    fireEvent.mouseEnter(screen.getByRole('button', { name: /Eraser/ }));
    fireEvent.keyDown(search, { key: 'Enter' });

    expect(useCanvasStore.getState().activeTool).toBe('eraser');
  });

  it('runs the theme toggle against the live theme hook', () => {
    theme.current = 'dark';
    open();

    fireEvent.click(screen.getByRole('button', { name: /Switch to light theme/ }));

    expect(theme.setTheme).toHaveBeenCalledWith('light');
  });

  it('clears the query after running a command, so the next open starts clean', () => {
    open();
    const search = screen.getByPlaceholderText('Search commands...') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'grid' } });
    fireEvent.click(screen.getByRole('button', { name: /Show grid/ }));

    act(() => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    });
    expect((screen.getByPlaceholderText('Search commands...') as HTMLInputElement).value).toBe('');
  });

  it('undoes through the store', () => {
    useCanvasStore.getState().setElements([rect('a')], { skipHistory: true });
    useCanvasStore.getState().updateElement('a', { x: 40 });
    open();

    fireEvent.change(screen.getByPlaceholderText('Search commands...'), {
      target: { value: 'undo' },
    });
    fireEvent.keyDown(screen.getByPlaceholderText('Search commands...'), { key: 'Enter' });

    expect(useCanvasStore.getState().elementsById.get('a')?.x).toBe(0);
  });
});
