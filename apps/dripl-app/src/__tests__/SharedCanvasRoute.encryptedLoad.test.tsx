import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lazy, Suspense, type ComponentType } from 'react';

/**
 * `components/canvas/SharedCanvasRoute.tsx` splits into two halves. The
 * pre-existing `SharedCanvasRoute.shareLoad.test.tsx` covers the plaintext
 * loader; this file covers the *encrypted* loader, both failure branches of the
 * loader, the unmount-during-decrypt cancellation, the error surface, and the
 * `CommandPalette` lazy import that only an `edit`-permission share mounts.
 *
 * The decryption helpers are mocked rather than exercised for real: what is
 * under test is this component's *use* of them (hash -> key -> decrypt ->
 * validate -> apply), not AES-GCM, which `@dripl/utils` owns and tests itself.
 */

const encryption = vi.hoisted(() => ({
  base64ToKey: vi.fn(async (base64: string) => ({ base64 })),
  decrypt: vi.fn(async (_payload: { iv: string; data: string }, _key: unknown) => [] as unknown[]),
}));

vi.mock('@dripl/utils/encryption', () => encryption);

// Canvas chrome: each of these pulls in editor machinery jsdom does not need.
// They render a marker rather than nothing, because "which chrome is mounted" is
// one of the things the permission gate decides.
vi.mock('@/components/canvas/CanvasControls', () => ({
  CanvasControls: () => <div data-testid="canvas-controls" />,
}));
vi.mock('@/components/canvas/CanvasToolbar', () => ({
  CanvasToolbar: () => <div data-testid="canvas-toolbar" />,
}));
vi.mock('@/components/canvas/TopBar', () => ({ TopBar: () => <div data-testid="top-bar" /> }));

vi.mock('@/components/button/Spinner', () => ({
  Spinner: ({ className }: { className?: string }) => (
    <div data-testid="spinner" className={className} />
  ),
}));

/** Records the props `CanvasBootstrap` was given, so the wiring is assertable. */
const bootstrapProps = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));

vi.mock('@/components/canvas/CanvasBootstrap', () => ({
  CanvasBootstrap: (props: Record<string, unknown>) => {
    bootstrapProps.current = props;
    return null;
  },
}));

/** Records that the lazy `CommandPalette` module actually resolved. */
const paletteLoaded = vi.hoisted(() => ({ count: 0 }));

vi.mock('@/components/canvas/CommandPalette', () => ({
  CommandPalette: () => {
    paletteLoaded.count += 1;
    return <div data-testid="command-palette" />;
  },
}));

/**
 * `next/dynamic` needs a bundler runtime a test does not have. The replacement
 * is faithful in the one way that matters here: it *invokes the loader* and
 * resolves the named export, inside a `Suspense` boundary, exactly as the real
 * helper does. A stub that ignored the loader would leave the component's
 * `import(...).then(m => m.CommandPalette)` line unexecuted and unobservable.
 */
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<ComponentType<Record<string, unknown>>>) => {
    // `next/dynamic` accepts a loader that resolves to the component itself;
    // `React.lazy` wants a module namespace, so the result is re-wrapped. The
    // loader is still invoked by React, which is the part under test.
    const Lazy = lazy(async () => ({ default: await loader() }));
    return function DynamicStub(props: Record<string, unknown>) {
      return (
        <Suspense fallback={null}>
          <Lazy {...props} />
        </Suspense>
      );
    };
  },
}));

const store = vi.hoisted(() => ({
  setElements: vi.fn(),
  setFileMetadata: vi.fn(),
  setSelectedIds: vi.fn(),
  setUserId: vi.fn(),
}));

vi.mock('@/lib/store', () => ({
  useCanvasStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        setElements: store.setElements,
        setFileMetadata: store.setFileMetadata,
        setSelectedIds: store.setSelectedIds,
        setUserId: store.setUserId,
      }),
    { getState: () => ({}) }
  ),
}));

import { SharedCanvasRoute } from '@/components/canvas/SharedCanvasRoute';
import type { SharedCanvasRouteProps } from '@/components/canvas/SharedCanvasRoute';

type Share = SharedCanvasRouteProps['share'];

const ELEMENT = {
  id: 'el-1',
  type: 'rectangle',
  x: 10,
  y: 20,
  width: 100,
  height: 60,
};

const PAYLOAD = { iv: 'aXY=', data: 'Y2lwaGVy' };

function encryptedShare(overrides: Partial<Share> = {}): Share {
  return {
    file: { id: 'file-1', name: 'Shared board', updatedAt: '2026-01-01T00:00:00.000Z' },
    permission: 'view',
    encryptedPayload: PAYLOAD,
    // The server stores only the AES-GCM envelope, so an encrypted share's
    // `elements` is always empty. The loader must not read it.
    elements: [],
    ...overrides,
  };
}

function setHash(hash: string) {
  window.location.hash = hash;
}

beforeEach(() => {
  vi.clearAllMocks();
  paletteLoaded.count = 0;
  bootstrapProps.current = null;
  encryption.base64ToKey.mockImplementation(async (base64: string) => ({ base64 }));
  encryption.decrypt.mockImplementation(async () => []);
  setHash('');
});

afterEach(() => {
  cleanup();
  setHash('');
});

describe('SharedCanvasRoute: encrypted share decryption', () => {
  // Regression: the AES key lives in the URL fragment precisely because the
  // fragment never reaches the server. The loader is the only reader of
  // `window.location.hash`, and it must read it -- there is nowhere else the key
  // can come from.
  it('derives the key from the hash fragment and decrypts the payload', async () => {
    encryption.decrypt.mockImplementation(async () => [ELEMENT]);
    setHash('#key=aGVsbG8td29ybGQ');

    render(<SharedCanvasRoute token="tok" share={encryptedShare()} />);

    await waitFor(() => expect(store.setElements).toHaveBeenCalled());
    expect(encryption.base64ToKey).toHaveBeenCalledWith('aGVsbG8td29ybGQ');
    expect(encryption.decrypt).toHaveBeenCalledTimes(1);
    // The envelope is handed to `decrypt` verbatim -- the component does not
    // unpack or re-serialise it.
    expect(encryption.decrypt.mock.calls[0]?.[0]).toEqual(PAYLOAD);
    const [applied] = store.setElements.mock.calls[0]?.[0] as Array<{ id: string }>;
    expect(applied).toMatchObject({ id: 'el-1' });
  });

  // Regression: an encrypted share's plaintext `elements` array is empty by
  // construction, so reading it instead of decrypting yields a blank canvas --
  // exactly the failure this loader exists to prevent. Asserted as a
  // decrypt-call count, because "the canvas is empty" is equally the symptom of
  // a decrypt that never ran.
  it('never reads the plaintext elements array of an encrypted share', async () => {
    encryption.decrypt.mockImplementation(async () => [ELEMENT]);
    setHash('#key=a2V5');

    render(
      <SharedCanvasRoute
        token="tok"
        // A share that somehow carries both: the envelope must win.
        share={encryptedShare({ elements: [{ ...ELEMENT, id: 'should-not-appear' }] })}
      />
    );

    await waitFor(() => expect(store.setElements).toHaveBeenCalled());
    expect(encryption.decrypt).toHaveBeenCalledTimes(1);
    const [applied] = store.setElements.mock.calls[0]?.[0] as Array<{ id: string }>;
    expect(applied).toMatchObject({ id: 'el-1' });
  });

  // Regression: a payload that decrypts to something which is not an array is
  // treated as an empty scene rather than spread into the element list. Passing
  // a non-array to `z.array(...)` would fail validation with a misleading
  // "invalid elements" message instead of an empty canvas.
  it('treats a non-array decryption result as an empty scene', async () => {
    encryption.decrypt.mockImplementation(async () => ({ nope: true }) as unknown as unknown[]);
    setHash('#key=a2V5');

    render(<SharedCanvasRoute token="tok" share={encryptedShare()} />);

    await waitFor(() => expect(store.setElements).toHaveBeenCalled());
    expect(store.setElements).toHaveBeenCalledWith([], { skipHistory: true });
    expect(screen.queryByText(/invalid elements/i)).not.toBeInTheDocument();
  });

  // Regression: the fragment may carry more than the key. `URLSearchParams` is
  // used to *parse* the hash, so an unrelated parameter cannot be mistaken for
  // the key, and a keyed fragment still resolves -- percent-decoded, since
  // base64 padding arrives as `%3D` in a real share URL.
  it('reads the key out of a multi-parameter fragment', async () => {
    encryption.decrypt.mockImplementation(async () => [ELEMENT]);
    setHash('#mode=edit&key=cmVhbC1rZXk%3D%3D&v=2');

    render(<SharedCanvasRoute token="tok" share={encryptedShare()} />);

    await waitFor(() => expect(store.setElements).toHaveBeenCalled());
    expect(encryption.base64ToKey).toHaveBeenCalledWith('cmVhbC1rZXk==');
  });
});

describe('SharedCanvasRoute: loader failure surfaces', () => {
  // Regression: a fragment with no `key` parameter at all is a *different* case
  // from an empty fragment, and both must land on the named "missing key" error
  // rather than proceeding with an empty key. `readKeyFromHash` returns `null`
  // for both; what matters is that the caller's falsy check catches either.
  it('names the missing key when the fragment has no key parameter', async () => {
    encryption.decrypt.mockImplementation(async () => [ELEMENT]);
    setHash('#mode=view');

    render(<SharedCanvasRoute token="tok" share={encryptedShare()} />);

    await waitFor(() =>
      expect(screen.getByText('Missing encryption key in share URL fragment.')).toBeInTheDocument()
    );
    expect(encryption.base64ToKey).not.toHaveBeenCalled();
    expect(store.setElements).not.toHaveBeenCalled();
  });

  // Regression: the plaintext branch of the loader, when the server returned
  // `elements: null` instead of an array. `SharedFileResponse.elements` is
  // `unknown[] | null`, so `null` is a legitimate response and the ternary is
  // what keeps it from reaching `z.array(...)` as a parse error -- a recipient
  // would otherwise see "Shared scene contains invalid elements." for an empty
  // but perfectly valid share.
  it('loads an empty scene for a plaintext share whose elements are null', async () => {
    render(
      <SharedCanvasRoute
        token="tok"
        share={{
          file: { id: 'file-1', name: 'Empty board', updatedAt: '2026-01-01T00:00:00.000Z' },
          permission: 'view',
          encryptedPayload: null,
          elements: null,
        }}
      />
    );

    await waitFor(() => expect(store.setElements).toHaveBeenCalled());
    expect(store.setElements).toHaveBeenCalledWith([], { skipHistory: true });
    expect(screen.queryByText(/invalid elements/i)).not.toBeInTheDocument();
  });

  // Regression: the loader never throws its own error for a bad *shape* -- it
  // hands the whole array to the schema. Asserted as a decrypt call count of
  // zero for the plaintext path, which is what distinguishes "the plaintext branch
  // ran" from "the encrypted branch ran and happened to succeed".
  it('does not decrypt for a plaintext share', async () => {
    render(
      <SharedCanvasRoute
        token="tok"
        share={{
          file: { id: 'file-1', name: 'Plain board', updatedAt: '2026-01-01T00:00:00.000Z' },
          permission: 'view',
          encryptedPayload: null,
          elements: [ELEMENT],
        }}
      />
    );

    await waitFor(() => expect(store.setElements).toHaveBeenCalled());
    expect(encryption.decrypt).not.toHaveBeenCalled();
    expect(encryption.base64ToKey).not.toHaveBeenCalled();
  });

  // Regression: an encrypted share opened without its fragment -- pasted into a
  // new tab, or the fragment stripped by a redirect -- has no key at all. That
  // must be a *named* failure, not a silent blank canvas.
  it('names the missing key when the fragment carries none', async () => {
    setHash('');
    render(<SharedCanvasRoute token="tok" share={encryptedShare()} />);

    await waitFor(() =>
      expect(screen.getByText('Missing encryption key in share URL fragment.')).toBeInTheDocument()
    );
    expect(encryption.base64ToKey).not.toHaveBeenCalled();
    expect(store.setElements).not.toHaveBeenCalled();
  });

  // Regression: the error branch replaces the whole page, so the share chrome and
  // the canvas are not left behind a message. Asserted as absence, which is safe
  // here because the loader's own state is the only thing that can produce the
  // error -- there is no other writer of that subtree.
  it('replaces the canvas with the error message and drops the chrome', async () => {
    encryption.decrypt.mockImplementation(async () => {
      throw new Error('Decryption failed: bad key');
    });
    setHash('#key=wrong');

    render(<SharedCanvasRoute token="tok" share={encryptedShare()} />);

    await waitFor(() => expect(screen.getByText('Decryption failed: bad key')).toBeInTheDocument());
    expect(bootstrapProps.current).toBeNull();
    expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
  });

  // Regression: elements are validated through `DriplElementSchema` before they
  // reach the store, so a tampered payload cannot inject arbitrary shapes. The
  // failure is *named* rather than surfacing a raw Zod message, so the recipient
  // is not shown an internal error string.
  it('rejects a payload whose elements fail schema validation', async () => {
    encryption.decrypt.mockImplementation(async () => [{ id: 'el-1', type: 'not-a-shape' }]);
    setHash('#key=a2V5');

    render(<SharedCanvasRoute token="tok" share={encryptedShare()} />);

    await waitFor(() =>
      expect(screen.getByText('Shared scene contains invalid elements.')).toBeInTheDocument()
    );
    expect(store.setElements).not.toHaveBeenCalled();
  });

  // Regression: the scene is capacity-bounded by `MAX_SCENE_ELEMENTS` (5000), and
  // the bound is part of this loader's contract -- an over-sized share must fail
  // rather than render a canvas the renderer cannot handle. At the bound exactly,
  // validation still succeeds, which is what makes the over-bound case a real
  // boundary rather than a blanket rejection.
  it('rejects a payload larger than the scene capacity but accepts one at it', async () => {
    const atCapacity = Array.from({ length: 5000 }, (_, i) => ({ ...ELEMENT, id: `el-${i}` }));
    encryption.decrypt.mockImplementation(async () => atCapacity);
    setHash('#key=a2V5');

    const { unmount } = render(<SharedCanvasRoute token="tok" share={encryptedShare()} />);
    await waitFor(() => expect(store.setElements).toHaveBeenCalled());
    unmount();

    encryption.decrypt.mockImplementation(async () => [
      ...atCapacity,
      { ...ELEMENT, id: 'one-too-many' },
    ]);
    render(<SharedCanvasRoute token="tok" share={encryptedShare({ encryptedPayload: PAYLOAD })} />);

    await waitFor(() =>
      expect(screen.getByText('Shared scene contains invalid elements.')).toBeInTheDocument()
    );
  });

  // Regression: a rejection that is not an `Error` still produces a message. The
  // `instanceof` fallback is this component's own code -- dropping it would
  // render `scene.error` as `undefined`, i.e. a blank error page.
  it('falls back to a generic message for a non-Error rejection', async () => {
    encryption.decrypt.mockImplementation(async () => {
      throw 'string rejection';
    });
    setHash('#key=a2V5');

    render(<SharedCanvasRoute token="tok" share={encryptedShare()} />);

    await waitFor(() => expect(screen.getByText('Unable to open share link')).toBeInTheDocument());
  });
});

describe('SharedCanvasRoute: unmount during decryption', () => {
  // Regression: the loader is async, so unmounting mid-decrypt must not apply the
  // scene to the store afterwards. `cancelled` is the only guard against that,
  // and it is observable only as a *count* on `setElements`: nothing renders, so
  // "the canvas is empty" cannot tell a cancelled loader from a silent one.
  it('does not apply the scene when the component unmounts mid-decrypt', async () => {
    let releaseDecrypt: () => void = () => undefined;
    encryption.decrypt.mockImplementation(
      () =>
        new Promise<unknown[]>(resolve => {
          releaseDecrypt = () => resolve([ELEMENT]);
        })
    );
    setHash('#key=a2V5');

    const { unmount } = render(<SharedCanvasRoute token="tok" share={encryptedShare()} />);
    await waitFor(() => expect(encryption.decrypt).toHaveBeenCalled());

    unmount();
    releaseDecrypt();
    await Promise.resolve();
    await Promise.resolve();

    // The store is the only side channel the cancelled loader could have used.
    expect(store.setElements).not.toHaveBeenCalled();
    expect(store.setFileMetadata).not.toHaveBeenCalled();
    expect(store.setUserId).not.toHaveBeenCalled();
  });

  // Regression: the same guard applies on the failure path, and it is reachable
  // *without* unmounting: the effect's cleanup sets `cancelled` for the stale
  // loader whenever the effect re-runs. So a payload swap while the first decrypt
  // is in flight must not let the first (now-stale) loader's rejection paint an
  // error page over the second loader's still-pending, perfectly valid load.
  //
  // Without the guard, the error text appears and then disappears when the second
  // load lands -- a flash of "Unable to open share link" for a share that opens
  // fine, and a permanently wrong page for one whose second load never lands.
  it('ignores a stale loader rejection after the payload has changed', async () => {
    const deferreds: Array<{ reject: (error: Error) => void; resolve: () => void }> = [];
    let call = 0;
    encryption.decrypt.mockImplementation(() => {
      const index = call++;
      return new Promise<unknown[]>((resolve, reject) => {
        deferreds[index] = { resolve: () => resolve([ELEMENT]), reject };
      });
    });
    setHash('#key=a2V5');

    const first = encryptedShare();
    const { rerender } = render(<SharedCanvasRoute token="tok" share={first} />);
    await waitFor(() => expect(encryption.decrypt).toHaveBeenCalledTimes(1));

    // Swap the payload while the first decrypt is still outstanding.
    const second: Share = { ...first, encryptedPayload: { iv: 'b3RoZXI=', data: 'ZW5jaHBl' } };
    rerender(<SharedCanvasRoute token="tok" share={second} />);
    await waitFor(() => expect(encryption.decrypt).toHaveBeenCalledTimes(2));

    // The stale loader now fails.
    await act(async () => {
      deferreds[0]?.reject(new Error('stale failure'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByText('stale failure')).not.toBeInTheDocument();

    // ...and the current one succeeds, so the share opens normally. Exactly one
    // store write: the failed loader contributes none, and the second loader's
    // write is not doubled by the shared `setElements` reference.
    await act(async () => {
      deferreds[1]?.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(store.setElements).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/stale failure|Unable to open share link/)).not.toBeInTheDocument();
  });

  // Regression: a decrypt that rejects *after* unmount must not set state on a
  // dead component. Observable through the store writes the cancelled path is
  // forbidden from making.
  it('does not set error state when decryption rejects after unmount', async () => {
    let rejectDecrypt: (error: Error) => void = () => undefined;
    encryption.decrypt.mockImplementation(
      () =>
        new Promise<unknown[]>((_resolve, reject) => {
          rejectDecrypt = reject;
        })
    );
    setHash('#key=a2V5');

    const { unmount } = render(<SharedCanvasRoute token="tok" share={encryptedShare()} />);
    await waitFor(() => expect(encryption.decrypt).toHaveBeenCalled());

    unmount();
    rejectDecrypt(new Error('late failure'));
    await Promise.resolve();
    await Promise.resolve();

    // No store write and no thrown error escaped from the cancelled branch.
    expect(store.setElements).not.toHaveBeenCalled();
    expect(store.setFileMetadata).not.toHaveBeenCalled();
  });
});

describe('SharedCanvasRoute: permission wiring', () => {
  // Regression: a view-only share must not mount the editing chrome. `TopBar`,
  // `CanvasToolbar` and `CommandPalette` are all gated on `!readOnly`, and
  // `CanvasControls` (the zoom/undo affordances) is not -- it is shown either way.
  // The badge text is the recipient's confirmation that their view is enforced.
  //
  // Each gated element is asserted individually rather than as a group, so a
  // mutation that un-gates one of them cannot hide behind the other two still
  // being absent.
  it('mounts no editing chrome and labels the share view only', async () => {
    encryption.decrypt.mockImplementation(async () => [ELEMENT]);
    setHash('#key=a2V5');

    render(<SharedCanvasRoute token="tok" share={encryptedShare({ permission: 'view' })} />);

    await waitFor(() => expect(bootstrapProps.current).not.toBeNull());
    expect(screen.getByText('View only')).toBeInTheDocument();
    expect(bootstrapProps.current).toMatchObject({ mode: 'room', readOnly: true, theme: 'light' });
    expect(paletteLoaded.count).toBe(0);
    expect(screen.queryByTestId('top-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('canvas-toolbar')).not.toBeInTheDocument();
    // The non-gated control is present, which is what makes the three absences
    // above meaningful rather than a blank render.
    expect(screen.getByTestId('canvas-controls')).toBeInTheDocument();
  });

  // Regression: the inverse gate -- an `edit` share *does* mount the top bar and
  // the toolbar. Asserting only the view-only absences would also pass for a
  // component that never renders either surface.
  it('mounts the editing chrome for an edit share', async () => {
    encryption.decrypt.mockImplementation(async () => [ELEMENT]);
    setHash('#key=a2V5');

    render(<SharedCanvasRoute token="tok" share={encryptedShare({ permission: 'edit' })} />);

    await waitFor(() => expect(screen.getByTestId('top-bar')).toBeInTheDocument());
    expect(screen.getByTestId('canvas-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('canvas-controls')).toBeInTheDocument();
  });

  // Regression: `permission` is normalised to exactly `'edit'` or `'view'`, and
  // anything else is treated as view. Dropping the normalisation would let an
  // unexpected permission string fall through the `=== 'view'` check and produce
  // a writable canvas for a read-only share.
  it('treats an unrecognised permission as view only', async () => {
    encryption.decrypt.mockImplementation(async () => [ELEMENT]);
    setHash('#key=a2V5');

    render(
      <SharedCanvasRoute
        token="tok"
        share={encryptedShare({
          permission: 'owner' as SharedCanvasRouteProps['share']['permission'],
        })}
      />
    );

    await waitFor(() => expect(bootstrapProps.current).not.toBeNull());
    expect(screen.getByText('View only')).toBeInTheDocument();
    expect(bootstrapProps.current).toMatchObject({ readOnly: true });
  });

  // Regression: an edit share mounts the command palette. This is the only
  // render path that resolves the lazy `CommandPalette` import, so it is also the
  // only thing that can execute the component's
  // `import(...).then(m => m.CommandPalette)` line -- a wrong export name would
  // leave the palette missing with no error until the user pressed Cmd+K.
  it('lazily loads and mounts the command palette for an edit share', async () => {
    encryption.decrypt.mockImplementation(async () => [ELEMENT]);
    setHash('#key=a2V5');

    render(<SharedCanvasRoute token="tok" share={encryptedShare({ permission: 'edit' })} />);

    expect(screen.getByText('Shared edit mode · transport is not E2EE')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('command-palette')).toBeInTheDocument());
    expect(paletteLoaded.count).toBeGreaterThan(0);
  });

  // Regression: `CanvasBootstrap` receives the share token and the room slug
  // derived from the file id. Dropping `shareToken` makes the collaboration
  // socket join an ordinary room instead of the share's, which silently loses the
  // share's permission on the socket.
  it('passes the token and the file-id slug to the canvas bootstrap', async () => {
    encryption.decrypt.mockImplementation(async () => [ELEMENT]);
    setHash('#key=a2V5');

    render(
      <SharedCanvasRoute
        token="share-token-abc"
        share={encryptedShare({
          permission: 'edit',
          file: { ...encryptedShare().file, id: 'file-77' },
        })}
      />
    );

    await waitFor(() => expect(bootstrapProps.current).not.toBeNull());
    expect(bootstrapProps.current).toMatchObject({
      roomSlug: 'file-77',
      shareToken: 'share-token-abc',
      readOnly: false,
    });
  });
});

describe('SharedCanvasRoute: payload identity gate', () => {
  // Regression: the loader is keyed on payload *identity*, and the early return
  // is what stops a re-run from re-decrypting. The effect's dependency array
  // contains more than the payload (the file id and name, and the three store
  // setters), so a change to any of those re-runs the effect even though the
  // payload did not change -- and without the identity gate, every such re-run
  // would re-derive a key and re-decrypt the whole scene.
  //
  // The microtasks are flushed *after* the rerender deliberately: `decrypt` is
  // reached only after an `await base64ToKey(...)`, so asserting the call count
  // synchronously would pass even with the gate removed.
  it('skips the loader entirely when only the file name changes', async () => {
    encryption.decrypt.mockImplementation(async () => [ELEMENT]);
    setHash('#key=a2V5');

    const share = encryptedShare();
    const { rerender } = render(<SharedCanvasRoute token="tok" share={share} />);
    await waitFor(() => expect(store.setElements).toHaveBeenCalledTimes(1));
    expect(encryption.decrypt).toHaveBeenCalledTimes(1);

    const renamed: Share = { ...share, file: { ...share.file, name: 'Renamed board' } };
    rerender(<SharedCanvasRoute token="tok" share={renamed} />);
    rerender(<SharedCanvasRoute token="tok" share={renamed} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(encryption.decrypt).toHaveBeenCalledTimes(1);
    expect(store.setElements).toHaveBeenCalledTimes(1);
  });

  // Regression: the applied payload is recorded with both `elements` and
  // `encryptedPayload`, so a payload that swaps one for the other (an encrypted
  // share becoming plaintext, or a plaintext one becoming encrypted) is treated
  // as genuinely new and is loaded again.
  it('reloads when the payload identity changes', async () => {
    encryption.decrypt.mockImplementation(async () => [ELEMENT]);
    setHash('#key=a2V5');

    const { rerender } = render(<SharedCanvasRoute token="tok" share={encryptedShare()} />);
    await waitFor(() => expect(store.setElements).toHaveBeenCalledTimes(1));

    rerender(
      <SharedCanvasRoute
        token="tok"
        share={encryptedShare({ encryptedPayload: { iv: 'b3RoZXI=', data: 'ZW5jaHBoZQ==' } })}
      />
    );

    await waitFor(() => expect(store.setElements).toHaveBeenCalledTimes(2));
    expect(encryption.decrypt).toHaveBeenCalledTimes(2);
  });

  // Regression: a successful load resets the selection and stamps the file
  // metadata and a fresh user id. Without the selection reset the recipient
  // inherits stale selected ids from whatever the store held.
  it('resets the selection and stamps file metadata on a successful load', async () => {
    encryption.decrypt.mockImplementation(async () => [ELEMENT]);
    setHash('#key=a2V5');

    render(<SharedCanvasRoute token="tok" share={encryptedShare()} />);

    await waitFor(() => expect(store.setElements).toHaveBeenCalled());
    expect(store.setSelectedIds).toHaveBeenCalledTimes(1);
    const [selected] = store.setSelectedIds.mock.calls[0] as [Set<string>];
    expect(selected).toBeInstanceOf(Set);
    expect(selected.size).toBe(0);
    expect(store.setFileMetadata).toHaveBeenCalledWith('file-1', 'Shared board');
    expect(store.setUserId).toHaveBeenCalledTimes(1);
    const [userId] = store.setUserId.mock.calls[0] as [string];
    expect(userId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
