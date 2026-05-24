import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DriplElement } from '@dripl/common';

vi.mock('@dripl/element/staticScene', () => ({
  renderStaticScene: vi.fn(),
}));

import StaticCanvas from '@/components/canvas/StaticCanvas';
import { renderStaticScene } from '@dripl/element/staticScene';

function createElement(id: string): DriplElement {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    strokeColor: '#000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
    updated: Date.now(),
  };
}

function viewport(x = 0, y = 0, zoom = 1) {
  return { x, y, zoom, width: 800, height: 600 };
}

describe('StaticCanvas RAF loop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('re-renders when elements change via continuous RAF loop', () => {
    const initialElements = [createElement('el-1')];

    const { rerender } = render(
      <StaticCanvas
        elements={initialElements}
        selectedIds={new Set()}
        viewport={viewport()}
        theme="light"
      />
    );

    // Frame 1: initial render — isDirty = true → renderStaticScene called
    vi.advanceTimersToNextFrame();
    expect(renderStaticScene).toHaveBeenCalledTimes(1);

    // Frame 2: nothing changed — isDirty = false → renderStaticScene NOT called
    vi.advanceTimersToNextFrame();
    expect(renderStaticScene).toHaveBeenCalledTimes(1);

    // Simulate adding a new element (like commitDraft does)
    const updatedElements = [...initialElements, createElement('el-2')];
    rerender(
      <StaticCanvas
        elements={updatedElements}
        selectedIds={new Set()}
        viewport={viewport()}
        theme="light"
      />
    );

    // Frame 3: elements changed → isDirty = true → renderStaticScene called
    vi.advanceTimersToNextFrame();
    expect(renderStaticScene).toHaveBeenCalledTimes(2);

    // Verify the last call received the updated elements
    const lastCall = (renderStaticScene as ReturnType<typeof vi.fn>).mock.lastCall;
    expect(lastCall?.[1]).toHaveLength(2);
  });
});
