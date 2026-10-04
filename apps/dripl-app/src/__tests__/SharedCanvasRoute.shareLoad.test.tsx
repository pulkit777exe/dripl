import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

import { SharedCanvasRoute } from '@/components/canvas/SharedCanvasRoute';

/**
 * A **plaintext** share link must put its scene on the canvas without waiting for
 * the collaboration socket.
 *
 * `scene` is initialised as `share.encryptedPayload ? 'pending' : { elements: [] }`,
 * so it only ever holds `'pending'` for an *encrypted* share. The loader used to be
 * gated on `if (scene !== 'pending') return`, which therefore returned immediately
 * and unconditionally for a plaintext share — `share.elements` was never read, and
 * the page fell back entirely on the websocket. A share link then rendered blank
 * whenever the room's snapshot was empty or never arrived, and an encrypted share's
 * scene is *always* empty server-side because the server stores only the AES-GCM
 * envelope.
 *
 * The gate now keys on the payload identity this scene is loaded from, never on
 * `scene` — the loader sets `scene`, so using it as its own trigger is circular.
 *
 * This test exists because reinstating the old gate passes the entire pre-existing
 * suite for this file; nothing else pinned the behaviour.
 */

// The canvas chrome around the loader is irrelevant to what is asserted here and
// each of these pulls in editor or store machinery jsdom does not need.
vi.mock('@/components/canvas/CanvasControls', () => ({ CanvasControls: () => null }));
vi.mock('@/components/canvas/CanvasToolbar', () => ({ CanvasToolbar: () => null }));
vi.mock('@/components/canvas/TopBar', () => ({ TopBar: () => null }));
vi.mock('@/components/button/Spinner', () => ({ Spinner: () => null }));

// `next/dynamic` needs a bundler runtime this test does not have; every lazily
// loaded component below the loader renders as nothing, which is irrelevant here.
vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

// `CanvasBootstrap` is a *named* export and pulls in the whole editor, Rough.js and
// the bitmap cache; stub it so this test exercises the loader and nothing else.
vi.mock('@/components/canvas/CanvasBootstrap', () => ({
  CanvasBootstrap: () => null,
}));

vi.mock('@/lib/store', () => ({
  useCanvasStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(storeState),
    { getState: () => storeState }
  ),
}));

const setElements = vi.fn();
const setFileMetadata = vi.fn();
const setSelectedIds = vi.fn();
const setUserId = vi.fn();
let storeState: Record<string, unknown>;

const ELEMENT = {
  id: 'el-1',
  type: 'rectangle',
  x: 10,
  y: 20,
  width: 100,
  height: 60,
};

beforeEach(() => {
  vi.clearAllMocks();
  storeState = {
    setElements,
    setFileMetadata,
    setSelectedIds,
    setUserId,
    elements: [],
  };
});

type Share = Parameters<typeof SharedCanvasRoute>[0]['share'];

/** A plaintext share: the case the old gate dropped on the floor. */
function plaintextShare(elements: unknown[] = [ELEMENT]): Share {
  return {
    file: { id: 'file-1', name: 'Shared board', updatedAt: '2026-01-01T00:00:00.000Z' },
    permission: 'view',
    // `null` is what makes `scene` initialise to `{ elements: [] }` rather than
    // `'pending'` -- so the old `scene !== 'pending'` return fired immediately.
    encryptedPayload: null,
    elements,
  };
}

describe('SharedCanvasRoute: a plaintext share loads without the socket', () => {
  it('applies the share payload to the store', async () => {
    render(<SharedCanvasRoute token="tok" share={plaintextShare()} />);

    await waitFor(() => expect(setElements).toHaveBeenCalled());
    // Not a deep equality: the loader validates through `DriplElementSchema`, which
    // fills defaults (`strokeColor`, `opacity`, `angle`, ...). What matters is that
    // the share's own element reached the store.
    const [applied] = setElements.mock.calls[0]?.[0] as Array<{ id: string }>;
    expect(applied).toMatchObject({ id: 'el-1', type: 'rectangle' });
  });

  it('does not re-apply the same payload on a re-render', async () => {
    const share = plaintextShare();
    const { rerender } = render(<SharedCanvasRoute token="tok" share={share} />);

    await waitFor(() => expect(setElements).toHaveBeenCalledTimes(1));
    rerender(<SharedCanvasRoute token="tok" share={share} />);
    rerender(<SharedCanvasRoute token="tok" share={share} />);

    // Identity-keyed, so an unrelated parent re-render cannot re-run the loader —
    // which is the same class of restart loop just fixed in `CanvasBootstrap`.
    expect(setElements).toHaveBeenCalledTimes(1);
  });

  it('applies a genuinely different payload', async () => {
    const { rerender } = render(<SharedCanvasRoute token="tok" share={plaintextShare()} />);
    await waitFor(() => expect(setElements).toHaveBeenCalledTimes(1));

    const other = plaintextShare([{ ...ELEMENT, id: 'el-2' }]);
    rerender(<SharedCanvasRoute token="tok" share={other} />);

    await waitFor(() => expect(setElements).toHaveBeenCalledTimes(2));
    const [applied] = setElements.mock.calls[1]?.[0] as Array<{ id: string }>;
    expect(applied).toMatchObject({ id: 'el-2' });
  });
});
