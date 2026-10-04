import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { DriplElement } from '@dripl/common';

/**
 * The regression test for the `/file/[id]` renderer blow-up.
 *
 * The defect was an unbounded React commit loop, not a leak in any single
 * allocation: `CanvasBootstrap`'s bootstrap effect depended on the `initialData`
 * *object*, React builds a fresh one on every parent render, and applying the
 * file scene re-rendered the parent. The assertion that matters is therefore
 * "the store is written once, no matter how often the parent re-renders", which
 * is what this file drives directly.
 *
 * The empty-scene case is kept as a control: it passes even with the bug
 * present, because `setElements([])` produces an array that shallow-compares
 * equal to itself and so never re-renders the parent. That asymmetry is the
 * reason the failure looked type-dependent when it was not.
 */

const loadInitialScene = vi.fn();
const setElements = vi.fn();
const storeState = {
  elements: [] as DriplElement[],
  isDrawing: false,
  currentStrokeColor: '#1e1e1e',
};

vi.mock('@/lib/scene-loader', () => ({
  loadInitialScene: (...args: unknown[]) => loadInitialScene(...args),
}));

vi.mock('@/components/canvas/RoughCanvas', () => ({ default: () => null }));
vi.mock('@/components/canvas/CanvasErrorBoundary', () => ({
  CanvasErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/lib/store', () => {
  const noop = () => {};
  // `currentStrokeColor` is read through getState() by the theme effect, so the
  // mock state has to carry the same shape the real store does or the effect
  // throws before the assertions run.
  const state = () => ({
    ...storeState,
    setElements,
    setSelectedIds: noop,
    setRoomSlug: noop,
    setReadOnly: noop,
    setCurrentStrokeColor: noop,
    setTheme: noop,
    setZoom: noop,
    setPan: noop,
    setCurrentBackgroundColor: noop,
    setCurrentStrokeWidth: noop,
    setCurrentRoughness: noop,
    setCurrentStrokeStyle: noop,
    setCurrentFillStyle: noop,
    setActiveTool: noop,
    setCanvasBackground: noop,
  });
  const selector = (sel: (s: Record<string, unknown>) => unknown) => sel(state());
  const useCanvasStore = Object.assign(selector, {
    getState: () => ({ ...state(), clearSelection: noop }),
    subscribe: () => () => {},
  });
  return { useCanvasStore };
});

import { CanvasBootstrap } from '@/components/canvas/CanvasBootstrap';

function element(id: string): DriplElement {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    strokeColor: '#000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
    updated: 1,
  } as DriplElement;
}

/**
 * A parent that re-renders on demand, passing a fresh `initialData` object each
 * time — the real `FileCanvasRoute` shape. Each `rerender()` is one turn of the
 * cycle that used to be self-sustaining.
 */
function makeParent(elements: DriplElement[]) {
  const observed: number[] = [];
  function Parent({ tick }: { tick: number }) {
    observed.push(tick);
    return (
      <CanvasBootstrap
        mode="file"
        theme="light"
        // A new object identity on every render, exactly as the real parent does.
        initialData={{ elements, appState: null }}
      />
    );
  }
  return { Parent, observed };
}

describe('CanvasBootstrap file-mode commit storm', () => {
  beforeEach(() => {
    loadInitialScene.mockReset();
    setElements.mockReset();
    storeState.elements = [];
  });

  it('applies a non-empty file scene once across many parent re-renders', async () => {
    const elements = [element('a'), element('b')];
    loadInitialScene.mockImplementation(async () => ({ elements, appState: null }));

    const { Parent } = makeParent(elements);
    const { rerender } = render(<Parent tick={0} />);

    // Ten further parent renders: ten fresh `initialData` objects. No `key`
    // change here — changing the key would remount, and an effect *should*
    // re-run on a remount. The defect is about re-rendering, not remounting.
    for (let tick = 1; tick <= 10; tick += 1) {
      rerender(<Parent tick={tick} />);
    }

    // Flush the bootstrap promise chain.
    await new Promise(resolve => setTimeout(resolve, 0));

    // The bug: one store write per parent render, i.e. one per React commit.
    expect(setElements).toHaveBeenCalledTimes(1);
    expect(loadInitialScene).toHaveBeenCalledTimes(1);
    expect(setElements.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it('does not reload when the parent re-renders with the same scene', async () => {
    const elements = [element('a')];
    loadInitialScene.mockImplementation(async () => ({ elements, appState: null }));

    const { Parent } = makeParent(elements);
    const { rerender } = render(<Parent tick={0} />);
    for (let tick = 1; tick <= 5; tick += 1) rerender(<Parent tick={tick} />);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(loadInitialScene).toHaveBeenCalledTimes(1);
  });

  it('still reloads when the scene itself changes', async () => {
    loadInitialScene.mockImplementation(async () => ({ elements: [element('a')], appState: null }));

    function Parent({ elements }: { elements: DriplElement[] }) {
      return (
        <CanvasBootstrap mode="file" theme="light" initialData={{ elements, appState: null }} />
      );
    }

    const { rerender } = render(<Parent elements={[element('a')]} />);
    await new Promise(resolve => setTimeout(resolve, 0));
    rerender(<Parent elements={[element('b')]} />);
    await new Promise(resolve => setTimeout(resolve, 0));

    // A different scene is a different key, so it must reload: the fix must not
    // turn "reloads once" into "reloads never".
    expect(loadInitialScene).toHaveBeenCalledTimes(2);
  });

  it('keeps the empty-scene control at one store write', async () => {
    loadInitialScene.mockImplementation(async () => ({ elements: [], appState: null }));

    const { Parent } = makeParent([]);
    const { rerender } = render(<Parent tick={0} />);
    for (let tick = 1; tick <= 5; tick += 1) rerender(<Parent tick={tick} />);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(setElements).toHaveBeenCalledTimes(1);
  });
});
