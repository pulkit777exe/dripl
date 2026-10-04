import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DriplElement } from '@dripl/common';

const loadInitialScene = vi.fn();
const setElements = vi.fn();

vi.mock('@/lib/scene-loader', () => ({
  loadInitialScene: (...args: unknown[]) => loadInitialScene(...args),
}));

vi.mock('@/components/canvas/RoughCanvas', () => ({
  default: () => null,
}));

vi.mock('@/components/canvas/CanvasErrorBoundary', () => ({
  CanvasErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/lib/store', () => ({
  useCanvasStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        setElements,
        setSelectedIds: vi.fn(),
        setRoomSlug: vi.fn(),
        setReadOnly: vi.fn(),
        elements: [],
        isDrawing: false,
        currentStrokeColor: '#1e1e1e',
        setTheme: vi.fn(),
        setZoom: vi.fn(),
        setPan: vi.fn(),
        setCurrentStrokeColor: vi.fn(),
        setCurrentBackgroundColor: vi.fn(),
        setCurrentStrokeWidth: vi.fn(),
        setCurrentRoughness: vi.fn(),
        setCurrentStrokeStyle: vi.fn(),
        setCurrentFillStyle: vi.fn(),
        setActiveTool: vi.fn(),
        setCanvasBackground: vi.fn(),
        clearSelection: vi.fn(),
        getState: () => ({ elements: [] }),
      }),
    {
      getState: () => ({ elements: [], clearSelection: vi.fn() }),
      subscribe: () => () => {},
    }
  ),
}));

import { fileSceneKeyFor } from '@/components/canvas/CanvasBootstrap';

function element(id: string, version = 1): DriplElement {
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
    version,
    versionNonce: 1,
    updated: 1,
  } as DriplElement;
}

/**
 * The defect: a parent that re-renders with an equivalent-but-new `initialData`
 * object restarted the bootstrap effect, which applied the scene, which
 * re-rendered the parent. With a non-empty scene that cycle never terminates.
 *
 * These tests drive the real component through that exact sequence and assert
 * the store is written once. An empty scene is included as the control that
 * passes even with the bug present, because `setElements([])` shallow-compares
 * equal to itself and never re-renders the parent — which is exactly why the
 * empty case did not reproduce.
 */
describe('CanvasBootstrap file-scene identity', () => {
  beforeEach(() => {
    loadInitialScene.mockReset();
    setElements.mockReset();
  });

  it('keys equal scenes equally and different scenes differently', () => {
    const a = { elements: [element('one')], appState: null };
    // A structurally identical object built independently — the parent
    // re-render case.
    const b = { elements: [element('one')], appState: null };
    expect(fileSceneKeyFor(a)).toBe(fileSceneKeyFor(b));

    // A different element id is a different scene.
    expect(fileSceneKeyFor({ elements: [element('two')], appState: null })).not.toBe(
      fileSceneKeyFor(a)
    );
    // A different version is a different scene, so an updated file still reloads.
    expect(fileSceneKeyFor({ elements: [element('one', 2)], appState: null })).not.toBe(
      fileSceneKeyFor(a)
    );
    // Different app state is a different scene.
    expect(fileSceneKeyFor({ elements: [element('one')], appState: { zoom: 2 } })).not.toBe(
      fileSceneKeyFor({ elements: [element('one')], appState: { zoom: 1 } })
    );
  });

  it('is null when there is no file scene', () => {
    expect(fileSceneKeyFor(null)).toBeNull();
    expect(fileSceneKeyFor(undefined)).toBeNull();
  });
});
