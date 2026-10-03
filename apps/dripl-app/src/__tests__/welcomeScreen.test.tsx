import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasStore } from '@/lib/store';
import type { ActiveTool } from '@/lib/store';
import { WelcomeScreen } from '@/components/canvas/WelcomeScreen';
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

function seed(elements: DriplElement[] = [], activeTool: ActiveTool = 'select') {
  useCanvasStore.setState({
    elements: [],
    elementsById: new Map(),
    selectedIds: new Set<string>(),
    activeTool,
    past: [],
    future: [],
    spatialVersion: 0,
    spatialChangedIds: [],
    spatialChangedIdsVersion: 0,
  });
  useCanvasStore.getState().setElements(elements, { skipHistory: true });
}

beforeEach(() => {
  seed();
});

describe('WelcomeScreen', () => {
  it('renders the tool picker on an empty canvas', () => {
    render(<WelcomeScreen onClose={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Welcome to Dripl' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Welcome to Dripl' })).toBeInTheDocument();
  });

  it('hides itself once the canvas has content', () => {
    const { container } = render(<WelcomeScreen onClose={vi.fn()} />);
    expect(container).not.toBeEmptyDOMElement();

    act(() => {
      useCanvasStore.getState().setElements([rect('a')], { skipHistory: true });
    });

    expect(screen.queryByRole('heading', { name: 'Welcome to Dripl' })).not.toBeInTheDocument();
  });

  it('selects a tool and dismisses itself', () => {
    const onClose = vi.fn();
    render(<WelcomeScreen onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /Rectangle tool/ }));

    expect(useCanvasStore.getState().activeTool).toBe('rectangle');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('marks the currently active tool as pressed', () => {
    seed([], 'ellipse');
    render(<WelcomeScreen onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: /Ellipse tool/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: /Rectangle tool/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('closes from both the icon and the start-drawing button', () => {
    const onClose = vi.fn();
    render(<WelcomeScreen onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close welcome screen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start drawing' }));

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('shows only the first three quick tips', () => {
    render(<WelcomeScreen onClose={vi.fn()} />);
    expect(screen.getByText(/Hold Space to temporarily switch/)).toBeInTheDocument();
    expect(screen.getByText(/Ctrl\+Alt\+G to toggle grid snapping/)).toBeInTheDocument();
    expect(screen.queryByText(/Ctrl\+Z to undo/)).not.toBeInTheDocument();
  });
});
