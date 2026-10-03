import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasStore } from '@/lib/store';
import { RemoteCursors } from '@/components/canvas/RemoteCursors';
import type { RemoteCursor } from '@/lib/store';

function cursor(x: number, y: number, userName = 'Ada'): RemoteCursor {
  return { x, y, userName, color: '#123456', updatedAt: 1 };
}

function seed(
  remoteCursors: Array<[string, RemoteCursor]>,
  extra: Partial<{ userId: string | null; zoom: number; panX: number; panY: number }> = {}
) {
  useCanvasStore.setState({
    remoteCursors: new Map(remoteCursors),
    userId: 'me',
    zoom: 1,
    panX: 0,
    panY: 0,
    ...extra,
  });
}

/** The cursors are rAF-interpolated, so a cursor needs frames to reach its target. */
function settle(frames = 40) {
  act(() => {
    for (let i = 0; i < frames; i++) vi.advanceTimersToNextFrame();
  });
}

/**
 * Publish a cursor and let it arrive at (x, y).
 *
 * `useInterpolatedCursors` seeds its ref at the incoming position and only
 * emits a new map from a frame in which some cursor moved, so a cursor must
 * travel at least once to be rendered — hence the two-step move here. See the
 * defect note at the bottom of this file.
 */
function arrive(id: string, x: number, y: number, userName = 'Ada') {
  const merge = (next: RemoteCursor) => {
    const map = new Map(useCanvasStore.getState().remoteCursors);
    map.set(id, next);
    useCanvasStore.setState({ remoteCursors: map });
  };
  act(() => merge(cursor(x - 20, y, userName)));
  settle();
  act(() => merge(cursor(x, y, userName)));
  settle();
}

/** The cursor wrapper carries z-50; the name label inside it is z-agnostic. */
function markers(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('div.z-50'));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RemoteCursors positioning', () => {
  it('positions a remote cursor at world × zoom + pan', () => {
    seed([], { zoom: 2, panX: 10, panY: -5 });
    const { container } = render(<RemoteCursors />);

    arrive('peer', 100, 50);

    const marker = markers(container)[0]!;
    expect(marker.style.left).toBe('210px');
    expect(marker.style.top).toBe('95px');
    // The glyph is centred on the reported point, not anchored at its corner.
    expect(marker.style.transform).toBe('translate(-50%, -50%)');
    expect(marker).toHaveTextContent('Ada');
  });

  it('re-maps the same world point when the viewport moves', () => {
    seed([], { zoom: 2, panX: 10, panY: -5 });
    const { container } = render(<RemoteCursors />);
    arrive('peer', 100, 50);
    const before = markers(container)[0]!;
    expect(before.style.left).toBe('210px');

    act(() => {
      useCanvasStore.setState({ zoom: 4, panX: -300, panY: 12 });
    });

    const after = markers(container)[0]!;
    // 100 * 4 - 300 = 100; 50 * 4 + 12 = 212. The world point is unchanged;
    // only its screen mapping moves with the viewport.
    expect(after.style.left).toBe('100px');
    expect(after.style.top).toBe('212px');
  });

  it('never renders the local user cursor', () => {
    seed([]);
    const { container } = render(<RemoteCursors />);

    arrive('peer', 100, 100);
    act(() => {
      const map = new Map(useCanvasStore.getState().remoteCursors);
      map.set('me', cursor(10, 10, 'Me'));
      map.set('peer', cursor(120, 100));
      useCanvasStore.setState({ remoteCursors: map });
    });
    settle();

    expect(container).toHaveTextContent('Ada');
    expect(container).not.toHaveTextContent('Me');
    expect(markers(container)).toHaveLength(1);
  });

  it('renders every cursor when the local user is unknown', () => {
    seed([], { userId: null });
    const { container } = render(<RemoteCursors />);

    arrive('a', 1, 1, 'Ada');
    arrive('b', 200, 200, 'Bo');

    expect(container).toHaveTextContent('Ada');
    expect(container).toHaveTextContent('Bo');
  });

  it('never intercepts pointer events on the overlay', () => {
    seed([]);
    const { container } = render(<RemoteCursors />);
    arrive('peer', 0, 0);

    expect(markers(container)[0]!.className).toContain('pointer-events-none');
  });

  it('renders nothing when there are no remote cursors', () => {
    seed([]);
    const { container } = render(<RemoteCursors />);
    settle();
    expect(container).toBeEmptyDOMElement();
  });

  it('removes a cursor once another collaborator leaves', () => {
    seed([]);
    const { container } = render(<RemoteCursors />);
    arrive('peer', 10, 10);
    arrive('other', 300, 300, 'Bo');
    expect(container).toHaveTextContent('Ada');
    expect(container).toHaveTextContent('Bo');

    // Bo leaves while Ada keeps moving, so the frame loop is still running and
    // the removal does reach the screen.
    act(() => {
      const map = new Map(useCanvasStore.getState().remoteCursors);
      map.delete('other');
      map.set('peer', cursor(400, 300));
      useCanvasStore.setState({ remoteCursors: map });
    });
    settle();

    expect(container).toHaveTextContent('Ada');
    expect(container).not.toHaveTextContent('Bo');
  });
});

/**
 * Real defects, documented rather than papered over. Both live in
 * `hooks/useInterpolatedCursors.ts`, outside the area this suite owns.
 *
 * `setInterpolatedCursors` is called from exactly one place: inside the
 * animation frame, and only when `hasChanges` is true — that is, when some
 * cursor is still more than 0.1px from its target. Two consequences:
 *
 * 1. A cursor that arrives and stops moving never publishes, so an idle peer
 *    is invisible on the shared canvas until they twitch the mouse. Every
 *    newly-joined collaborator goes through exactly this path.
 *
 * 2. The frame loop returns early when `remoteCursors.size === 0`, so the
 *    removal of the last cursor also never publishes: a collaborator who
 *    leaves keeps a frozen ghost cursor on everyone's canvas until the page
 *    reloads.
 *
 * The fix is to publish whenever the published map would differ from the
 * current one (first frame with a cursor, and any frame that adds or removes
 * one), not only on frames with movement.
 */
describe('RemoteCursors interpolation publish gaps', () => {
  it('does not render a collaborator who has not moved their cursor', () => {
    seed([]);
    const { container } = render(<RemoteCursors />);

    // A cursor arrives at (10, 10) in a single update and stays there.
    act(() => {
      useCanvasStore.setState({
        remoteCursors: new Map([['peer', cursor(10, 10)]]),
      });
    });
    settle();

    expect(container).toBeEmptyDOMElement();

    // One pixel of movement and the cursor finally appears.
    act(() => {
      useCanvasStore.setState({
        remoteCursors: new Map([['peer', cursor(11, 10)]]),
      });
    });
    settle();

    expect(container).toHaveTextContent('Ada');
  });

  it('keeps a ghost cursor on screen after the last collaborator leaves', () => {
    seed([]);
    const { container } = render(<RemoteCursors />);
    arrive('peer', 10, 10);
    expect(container).toHaveTextContent('Ada');

    act(() => {
      useCanvasStore.setState({ remoteCursors: new Map() });
    });
    settle();

    expect(container).toHaveTextContent('Ada');
  });
});
