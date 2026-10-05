import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import type { DriplElement } from '@dripl/common';

/**
 * `AIGenerateModal` refusals, busy-state and cancellation.
 *
 * A sibling file (`AIGenerateModal.test.tsx`) already covers the happy path and
 * three error shapes, but it replaces `@/lib/store` with a stub whose
 * `aiGenerating` never changes and whose `setAiGenerating` is a `vi.fn()` that
 * writes nothing. Every claim about *this* modal actually being busy — the
 * disabled Generate button, the `aria-busy` flag, the store's own
 * `aiGenerating`, and the re-check that refuses a result which lands after the
 * canvas has turned view-only — is therefore invisible to that file: the guard
 * reads a value that is permanently `false`.
 *
 * So this file drives the **real** store (`useCanvasStore.setState`, the
 * pattern used by `canvas-core-drawingtools.test.tsx`) and asserts on store
 * state rather than on call spies. `useModalAnimation` is stubbed so the open
 * gate does not depend on rAF timing, matching `ExportModal.test.tsx`.
 */

let mockVisible = true;

vi.mock('@/hooks/useModalAnimation', () => ({
  useModalAnimation: () => ({ isVisible: mockVisible, modalState: 'is-open' }),
}));

import { useCanvasStore } from '@/lib/store';
import { AIGenerateModal } from '@/components/canvas/AIGenerateModal';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * jsdom implements no SVG geometry at all and exposes no `SVGPathElement`
 * global to patch. Load-bearing: without this, the success check's own guard
 * (`typeof path.getTotalLength === 'function'`) is false, the dash maths never
 * runs, and a component that shipped a half-drawn tick would still pass every
 * test in this file. The prototype is taken from a real element so every `<path>`
 * React creates inherits the stub.
 *
 * Never removed. A React passive effect can flush *after* the test that rendered it
 * has finished, so deleting this in `afterEach` raced the effect that calls it -- and
 * because the component guards with `typeof path.getTotalLength === 'function'`, the
 * race failed *silently*: the dash maths was skipped and the assertion on
 * `strokeDasharray` failed instead, on whichever test happened to run next. A
 * prototype method standing in for a real browser API has no per-test state to unwind.
 */
function patchPathLength(length: number) {
  const proto = Object.getPrototypeOf(document.createElementNS(SVG_NS, 'path'));
  Object.defineProperty(proto, 'getTotalLength', { configurable: true, value: () => length });
}

function rect(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    ...extra,
  } as unknown as DriplElement;
}

function seedStore(extra: Record<string, unknown> = {}) {
  useCanvasStore.setState({
    elements: [],
    elementsById: new Map(),
    selectedIds: new Set<string>(),
    past: [],
    future: [],
    activeTool: 'select',
    draftElement: null,
    elementLocks: new Map<string, string>(),
    aiGenerating: false,
    readOnly: false,
    ...extra,
  } as never);
}

function elements(): DriplElement[] {
  return useCanvasStore.getState().elements;
}

function selected(): string[] {
  return [...useCanvasStore.getState().selectedIds];
}

/** Install a `fetch` that answers with a fixed response. */
function stubFetch(payload: unknown, init: { ok?: boolean; status?: number } = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => payload,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/**
 * Install a `fetch` that never settles on its own and rejects with a real
 * `AbortError` when the caller's `AbortSignal` fires. The component aborts via
 * `AbortController`; a mock that ignored `signal` would resolve anyway and the
 * late-result guards under test would never be reached.
 */
function stubAbortableFetch() {
  const signals: AbortSignal[] = [];
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
    const signal = init?.signal ?? undefined;
    if (signal) signals.push(signal);
    return new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () =>
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      );
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, signals };
}

/** Render, type a prompt, and click Generate. */
async function submit(prompt = 'A simple architecture diagram') {
  fireEvent.change(screen.getByLabelText('Describe your diagram'), { target: { value: prompt } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));
  });
}

/** Let the modal's await chain (fetch → json → store writes) run out. */
async function settle(times = 6) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/**
 * Anchored on purpose: the close button's label is "Close AI diagram
 * generator", so an unanchored `/generat/i` also matches it.
 */
function generateButton(): HTMLElement {
  return screen.getByRole('button', { name: /^generat/i });
}

beforeEach(() => {
  vi.useFakeTimers();
  mockVisible = true;
  patchPathLength(42.4);
  vi.clearAllMocks();
  seedStore();
  // No `document.body.innerHTML = ''` here: the modal renders through a portal
  // into `document.body`, and clearing it out from under React Testing Library
  // makes its own `cleanup()` throw, which unmounts nothing and leaves every
  // later test querying a body full of dead modals.
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('AIGenerateModal refusals never reach the model', () => {
  it('keeps Generate disabled for an empty or whitespace-only prompt', async () => {
    // Regression: an empty prompt is refused at the button, so the guard that
    // refuses it again inside `handleGenerate` is unreachable through the UI.
    // Pinned at the level the user can actually reach — the button. Dropping
    // `!prompt.trim()` from `disabled` would let a real click fire the request
    // with an empty body, which is what the inner guard exists to stop.
    render(<AIGenerateModal isOpen onClose={vi.fn()} />);
    await settle();

    expect(generateButton()).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Describe your diagram'), {
      target: { value: '   \n  ' },
    });
    await settle();
    expect(generateButton()).toBeDisabled();

    // A real prompt re-enables it, so the disabled state is the prompt's doing
    // and not a permanently broken button.
    fireEvent.change(screen.getByLabelText('Describe your diagram'), {
      target: { value: 'a flowchart' },
    });
    await settle();
    expect(generateButton()).toBeEnabled();
  });

  it('disables Generate and calls nothing while a request is in flight', async () => {
    // Regression: `aiGenerating` gates the button *and* the textarea. Without
    // it a user can keep editing the prompt while a request is outstanding,
    // then read the success check against a prompt they have already changed.
    const { fetchMock } = stubAbortableFetch();
    render(<AIGenerateModal isOpen onClose={vi.fn()} />);
    await settle();

    await submit();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(generateButton()).toBeDisabled();
    expect(generateButton()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByLabelText('Describe your diagram')).toBeDisabled();
    expect(useCanvasStore.getState().aiGenerating).toBe(true);
  });

  it('does not fire a second request when Generate is clicked again mid-flight', async () => {
    // Regression: the Generate button is `disabled` while a request is in
    // flight, and that outer gate is what this test pins — a click on the
    // disabled button never reaches the handler, so the user cannot double-spend
    // a request.
    //
    // Honest scope: the `inFlightRef` guard *inside* `handleGenerate` is not what
    // makes this pass. While a request is outstanding `aiGenerating` is true,
    // the button is disabled, and no click can arrive — so that guard is
    // unreachable through the UI (reported, not claimed as covered). This test
    // detects losing `aiGenerating` from the button's `disabled` binding; it
    // cannot detect losing the in-handler guard, and does not claim to.
    const { fetchMock } = stubAbortableFetch();
    render(<AIGenerateModal isOpen onClose={vi.fn()} />);
    await settle();

    await submit();
    await act(async () => {
      fireEvent.click(generateButton());
    });
    await settle();

    expect(generateButton()).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(elements()).toHaveLength(0);
  });

  it('never calls the model on a view-only canvas, and closes instead', async () => {
    // Regression: `readOnly` is the authz gate for a mutation, checked inside
    // `handleGenerate` as well as by the auto-close effect. A request here
    // would spend the quota and be rejected server-side anyway. The prompt is
    // typed first on purpose: with an empty prompt the Generate button is
    // disabled, the click never reaches the guard, and the test would pass
    // without exercising it at all.
    seedStore({ readOnly: true });
    const fetchMock = stubFetch({ elements: [rect('gen')] });
    const onClose = vi.fn();
    render(<AIGenerateModal isOpen onClose={onClose} />);
    await settle();

    await submit();
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/view-only/i);
    expect(onClose).toHaveBeenCalled();
    expect(elements()).toHaveLength(0);
  });

  it('refuses a prompt past the length cap without calling the model', async () => {
    // Regression: the textarea carries `maxLength`, so a browser user cannot
    // normally exceed the cap — this is the defence-in-depth layer that catches
    // a programmatic or autofilled value. jsdom does not enforce `maxLength` on
    // a React-controlled textarea, which is what lets the branch be reached.
    const fetchMock = stubFetch({ elements: [rect('gen')] });
    render(<AIGenerateModal isOpen onClose={vi.fn()} />);
    await settle();

    await submit('x'.repeat(2001));
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(elements()).toHaveLength(0);
  });
});

describe('AIGenerateModal releases the busy flag on failure', () => {
  it('fires one request for two Generate clicks in the same tick', async () => {
    // Regression: the guard is `if (aiGenerating || inFlightRef.current) return`.
    // The `disabled` attribute is not in the DOM until React re-renders, so without
    // the ref a second click inside the same tick reaches the handler and starts a
    // second generation -- two model calls, two `addElements`, and a race over which
    // result lands last. `login/page.tsx` has the same shape and the same gap;
    // `DashboardFiles` shows the established fix, a ref latched before the await.
    //
    // All three clicks are issued inside one `act`, before any re-render can disable
    // the button. That is exactly the window the ref exists to close, and it is why
    // asserting on the button's `disabled` attribute would prove nothing.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ elements: [rect('once')] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AIGenerateModal isOpen onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Describe your diagram'), {
      target: { value: 'A simple architecture diagram' },
    });

    const button = generateButton();
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // One request means one result applied, not three.
    expect(elements().map(e => e.id)).toEqual(['once']);
  });
  it('shows the failure and makes Generate usable again', async () => {
    // Regression: `setAiGenerating(false)` lives in a `finally`. Remove it and
    // the modal is bricked for the rest of the session after one failed
    // request — the button, the textarea and the examples all stay disabled,
    // with the failure message as the only clue.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('upstream exploded')));
    render(<AIGenerateModal isOpen onClose={vi.fn()} />);
    await settle();

    await submit();
    await settle();

    expect(screen.getByRole('alert')).toHaveTextContent('upstream exploded');
    expect(useCanvasStore.getState().aiGenerating).toBe(false);
    expect(generateButton()).toBeEnabled();
    expect(generateButton()).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByLabelText('Describe your diagram')).toBeEnabled();
    expect(elements()).toHaveLength(0);
  });

  it('recovers on a second attempt after a failure', async () => {
    // Regression: the `inFlightRef` reset also lives in the `finally`. Without
    // it `inFlightRef.current` stays `true` forever and every later attempt
    // returns early with no error at all — a silent, permanent no-op button.
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ elements: [rect('second-try')] }),
      });
    vi.stubGlobal('fetch', fetchMock);
    render(<AIGenerateModal isOpen onClose={vi.fn()} />);
    await settle();

    await submit();
    await settle();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(generateButton());
    });
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(elements().map(e => e.id)).toEqual(['second-try']);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the generic failure for a rejection that is not an Error', async () => {
    // Regression: `caught instanceof Error` decides between the thrown message
    // and a generic fallback. `fetch` rejects with a `TypeError` normally, but a
    // service worker or an interceptor can reject with anything — and reading
    // `.message` off a non-Error yields `undefined`, putting the literal text
    // "undefined" in the alert box.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('network gone'));
    render(<AIGenerateModal isOpen onClose={vi.fn()} />);
    await settle();

    await submit();
    await settle();

    expect(screen.getByRole('alert')).toHaveTextContent(/could not generate/i);
    expect(screen.getByRole('alert')).not.toHaveTextContent(/undefined/);
    expect(useCanvasStore.getState().aiGenerating).toBe(false);
    expect(elements()).toHaveLength(0);
  });

  it('reports an unreadable body instead of a raw parse exception', async () => {
    // Regression: a proxy or gateway returning HTML with a 200. `.json()`
    // rejecting must not surface `Unexpected token <` to the user, and must not
    // leave the modal stuck busy.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
      })
    );
    render(<AIGenerateModal isOpen onClose={vi.fn()} />);
    await settle();

    await submit();
    await settle();

    expect(screen.getByRole('alert')).not.toHaveTextContent(/Unexpected token/i);
    expect(useCanvasStore.getState().aiGenerating).toBe(false);
    expect(elements()).toHaveLength(0);
  });
});

describe('AIGenerateModal cancellation', () => {
  it('aborts the request in flight and closes when the backdrop is clicked', async () => {
    // Regression: the backdrop's handler is `cancelGeneration`, which aborts
    // *and* closes. Pinning the actual behaviour: the modal does close on a
    // backdrop click mid-request (it does not refuse to), and the outstanding
    // request is aborted rather than left running against a closed modal.
    const { signals } = stubAbortableFetch();
    const onClose = vi.fn();
    render(<AIGenerateModal isOpen onClose={onClose} />);
    await settle();
    await submit();

    expect(signals[0]!.aborted).toBe(false);

    await act(async () => {
      fireEvent.click(document.querySelector('.t-modal')!);
    });

    expect(signals[0]!.aborted).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not apply a result that arrives after Cancel', async () => {
    // Regression: cancel aborts, and the abort rejection must be swallowed
    // silently — no error banner, and above all no `addElements` once the
    // response eventually lands. Showing an error for a cancel the user asked
    // for is its own bug, but writing the elements is the expensive one.
    const { signals } = stubAbortableFetch();
    const onClose = vi.fn();
    render(<AIGenerateModal isOpen onClose={onClose} />);
    await settle();
    await submit();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    });
    await settle();

    expect(signals[0]!.aborted).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(elements()).toHaveLength(0);
    expect(useCanvasStore.getState().aiGenerating).toBe(false);
    // The abort is not an error the user needs to be told about.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('aborts an in-flight request when the modal is closed by its parent', async () => {
    // Regression: the `!isOpen` branch aborts. Without it, unmounting mid-request
    // leaves a live `AbortController` and a pending promise whose resolution
    // writes to a store the user has already navigated away from.
    const { signals } = stubAbortableFetch();
    const { rerender } = render(<AIGenerateModal isOpen onClose={vi.fn()} />);
    await settle();
    await submit();

    rerender(<AIGenerateModal isOpen={false} onClose={vi.fn()} />);
    await settle();

    expect(signals[0]!.aborted).toBe(true);
  });

  it('aborts on Escape and prevents the default', async () => {
    // Regression: Escape is the only keyboard route out, and it must suppress
    // the browser's own handling too. `dispatchEvent` returns `false` exactly
    // when a cancelable event had `preventDefault` called on it.
    const { signals } = stubAbortableFetch();
    const onClose = vi.fn();
    render(<AIGenerateModal isOpen onClose={onClose} />);
    await settle();
    await submit();

    let notCancelled = true;
    await act(async () => {
      notCancelled = fireEvent.keyDown(document, { key: 'Escape', cancelable: true });
    });

    expect(notCancelled).toBe(false);
    expect(signals[0]!.aborted).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('AIGenerateModal applying a result', () => {
  it('adds the generated elements, selects only them, and leaves the existing scene alone', async () => {
    // Regression: the success path appends and re-selects. If it ever replaced
    // the scene, or selected the union, a user who generated one diagram on a
    // populated canvas would lose their work.
    seedStore();
    useCanvasStore.getState().setElements([rect('existing')], { skipHistory: true });
    stubFetch({ elements: [rect('gen-a'), rect('gen-b')] });

    render(<AIGenerateModal isOpen onClose={vi.fn()} />);
    await settle();
    await submit();
    await settle();

    expect(elements().map(e => e.id)).toEqual(['existing', 'gen-a', 'gen-b']);
    expect(selected()).toEqual(['gen-a', 'gen-b']);
    expect(useCanvasStore.getState().activeTool).toBe('select');
  });

  it('keeps only the first of two generated elements that share an id', async () => {
    // Regression: the model can echo the same `id` twice. Passing both to
    // `addElements` would produce a scene whose `elementsById` map and
    // `elements` array disagree — the copy the index lost is still rendered and
    // still hit-testable, and every later update hits only one of them.
    stubFetch({ elements: [rect('dupe'), rect('dupe', { x: 500 })] });

    render(<AIGenerateModal isOpen onClose={vi.fn()} />);
    await settle();
    await submit();
    await settle();

    expect(elements().map(e => e.id)).toEqual(['dupe']);
    expect(elements()[0]!.x).toBe(0);
    expect(selected()).toEqual(['dupe']);
  });

  it('refuses a result that lands after the canvas has turned view-only', async () => {
    // Regression: the second `readOnly` check, after the await. Losing it is the
    // classic TOCTOU: a viewer who gained edit rights mid-request — or lost them
    // — would get generated elements written into a canvas they may not edit.
    const fetchMock = vi.fn(async () => {
      useCanvasStore.setState({ readOnly: true } as never);
      return { ok: true, status: 200, json: async () => ({ elements: [rect('late')] }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AIGenerateModal isOpen onClose={vi.fn()} />);
    await settle();
    await submit();
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent(/view-only/i);
    expect(elements()).toHaveLength(0);
    expect(selected()).toEqual([]);
  });

  it('shows only the first warning and stays open longer because of it', async () => {
    // Regression: `warnings[0]` is the one shown, and a response carrying
    // warnings holds the modal open 2400ms instead of 1200ms so the user has
    // time to read it. Showing `warnings[1]` or closing on the short timer
    // would hide the message the response bothered to send.
    stubFetch({
      elements: [rect('gen')],
      warnings: ['first warning', 'second warning'],
    });
    const onClose = vi.fn();
    render(<AIGenerateModal isOpen onClose={onClose} />);
    await settle();
    await submit();
    await settle();

    expect(screen.getByText('first warning')).toBeInTheDocument();
    expect(screen.queryByText('second warning')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1200);
    });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1200);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on the short timer and clears the prompt when there are no warnings', async () => {
    // Regression: no warnings means the short timer, and the prompt is reset on
    // close. Leaving the old prompt behind means the next open re-sends the
    // previous diagram request the moment the user presses Generate.
    stubFetch({ elements: [rect('gen')] });
    const onClose = vi.fn();
    const { rerender } = render(<AIGenerateModal isOpen onClose={onClose} />);
    await settle();
    await submit();
    await settle();

    await act(async () => {
      vi.advanceTimersByTime(1200);
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<AIGenerateModal isOpen={false} onClose={onClose} />);
    await settle();
    rerender(<AIGenerateModal isOpen onClose={onClose} />);
    await settle();

    expect(screen.getByLabelText('Describe your diagram')).toHaveValue('');
  });

  it('prepares the success tick for its draw-in from the measured path length', async () => {
    // Regression: the check animates in from a full dash offset. `Math.ceil`
    // matters — a truncated offset leaves a visible stub of the path for the
    // whole animation, which is the artefact this line exists to prevent.
    // Load-bearing `getTotalLength` patch; see `patchPathLength`.
    stubFetch({ elements: [rect('gen')] });
    render(<AIGenerateModal isOpen onClose={vi.fn()} />);
    await settle();
    await submit();
    await settle();

    const tick = document.querySelector('.t-success-check path') as SVGPathElement;
    expect(tick).not.toBeNull();
    // 42.4 rounds up to 43, not 42.
    expect(tick.style.strokeDasharray).toBe('43');
    expect(tick.style.strokeDashoffset).toBe('43');
  });
});

describe('AIGenerateModal error messages', () => {
  async function submitAndReadAlert(payload: unknown, status: number) {
    stubFetch(payload, { ok: false, status });
    render(<AIGenerateModal isOpen onClose={vi.fn()} />);
    await settle();
    await submit();
    await settle();
    return screen.getByRole('alert').textContent ?? '';
  }

  it('uses the upstream message for the two codes the server defines', async () => {
    // Regression: `AI_INCOMPLETE` and `CONTENT_BLOCKED` carry an
    // already-user-facing explanation. Falling through to the generic
    // "could not generate a diagram" would replace a specific reason with a
    // shrug. Both codes asserted because the guard is a two-value comparison,
    // and widening it to one is the regression.
    for (const code of ['AI_INCOMPLETE', 'CONTENT_BLOCKED']) {
      const text = await submitAndReadAlert({ code, error: `Reason for ${code}` }, 422);
      expect(text).toBe(`Reason for ${code}`);
      cleanup();
    }
  });

  it('names the origin rejection for a 403', async () => {
    // Regression: a 403 from the CSRF/origin guard is an environment problem,
    // not a prompt problem. The generic message would send the user off to
    // rewrite a prompt that was never the issue.
    expect(await submitAndReadAlert({}, 403)).toMatch(/not allowed from the current site/i);
  });

  it('rounds a rate-limit retry delay up to whole seconds', async () => {
    // Regression: `Math.ceil` on `retryAfter`. Flooring tells a user to retry in
    // 3 seconds when the server said 3.2, i.e. before the limit resets.
    expect(await submitAndReadAlert({ retryAfter: 3.2 }, 429)).toMatch(/in 4 seconds/i);
  });

  it('clamps a sub-second rate-limit delay up to one second', async () => {
    // Regression: `Math.max(1, ...)`. Without the floor a `retryAfter` of 0.4
    // becomes "in 0 seconds" — an instruction to retry before the limit resets,
    // which is the one thing a rate-limit message must not say.
    //
    // 0.4 rather than 0 on purpose: `0` is falsy, so it takes the `retryAfter &&`
    // arm and lands on the generic message instead. That truthiness guard is
    // the subject of the test below.
    expect(await submitAndReadAlert({ retryAfter: 0.4 }, 429)).toMatch(/in 1 seconds/i);
  });

  it('falls back to a generic rate-limit message with no usable retry hint', async () => {
    // Regression: the absent, zero and non-numeric `retryAfter` arms, all of
    // which must avoid a delay message. `0` is the interesting one: the guard is
    // `retryAfter &&`, not a range check, so an explicit zero counts as "no
    // hint". Pinned as the source actually behaves rather than as it might
    // ideally behave — "in NaN seconds" must never reach the user.
    for (const payload of [{}, { retryAfter: 0 }, { retryAfter: 'soon' }]) {
      const text = await submitAndReadAlert(payload, 429);
      expect(text).toMatch(/temporarily rate-limited/i);
      expect(text).not.toMatch(/NaN|0 seconds/);
      cleanup();
    }
  });

  it('reports a 503 as a temporary outage rather than a bad prompt', async () => {
    // Regression: 502/503 share one message because both mean "upstream is
    // down". Mapping them to the generic failure would read as the user's fault.
    expect(await submitAndReadAlert({}, 503)).toMatch(/temporarily unavailable/i);
  });

  it('trims an upstream error message and caps its length', async () => {
    // Regression: `payload.error.trim().slice(0, 300)`. The trim keeps padding
    // out of the banner; the cap keeps an upstream stack-trace-shaped string
    // from filling the panel. Length is asserted rather than guessed.
    const padded = `   ${'e'.repeat(400)}   `;
    const text = await submitAndReadAlert({ error: padded }, 400);
    expect(text).toBe('e'.repeat(300));
  });

  it('falls back to the generic failure when the body carries no usable message', async () => {
    // Regression: the last resort. A whitespace-only `error` is not a message,
    // so `.trim()` being falsy is what routes this to the fallback rather than
    // rendering an empty alert box.
    expect(await submitAndReadAlert({ error: '   ' }, 500)).toMatch(/could not generate/i);
  });
});

describe('AIGenerateModal keyboard and focus', () => {
  it('wraps Tab from the last control back to the first', async () => {
    // Regression: the focus trap. Without the wrap, Tab from the last control
    // moves focus behind the modal, into the canvas, where the next keystroke
    // is handled by a component the user cannot see.
    render(<AIGenerateModal isOpen onClose={vi.fn()} />);
    await settle();

    const last = screen.getByRole('button', { name: /^cancel$/i });
    last.focus();
    expect(document.activeElement).toBe(last);

    let notCancelled = true;
    await act(async () => {
      notCancelled = fireEvent.keyDown(document, { key: 'Tab', cancelable: true });
    });

    expect(notCancelled).toBe(false);
    expect(document.activeElement).toHaveAttribute('aria-label', 'Close AI diagram generator');
  });

  it('wraps Shift+Tab from the first control to the last', async () => {
    // Regression: the other arm of the trap. Backwards out of the first control
    // must land on the last, not on the page behind.
    render(<AIGenerateModal isOpen onClose={vi.fn()} />);
    await settle();

    screen.getByRole('button', { name: 'Close AI diagram generator' }).focus();

    let notCancelled = true;
    await act(async () => {
      notCancelled = fireEvent.keyDown(document, { key: 'Tab', shiftKey: true, cancelable: true });
    });

    expect(notCancelled).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^cancel$/i }));
  });

  it('leaves Tab alone in the middle of the dialog', async () => {
    // Regression: the negative. The trap must not hijack ordinary forward Tab —
    // if it did, a user could never reach the textarea from the close button.
    render(<AIGenerateModal isOpen onClose={vi.fn()} />);
    await settle();

    const textarea = screen.getByLabelText('Describe your diagram');
    textarea.focus();

    let notCancelled = true;
    await act(async () => {
      notCancelled = fireEvent.keyDown(document, { key: 'Tab', cancelable: true });
    });

    expect(notCancelled).toBe(true);
    expect(document.activeElement).toBe(textarea);
  });

  it('ignores a Tab when there is nothing focusable to wrap between', async () => {
    // Regression: `focusable.length === 0` returns before indexing `first`/`last`.
    // Without it, `focusable[focusable.length - 1]` is `undefined` and
    // `first.focus()` throws inside a keydown listener.
    //
    // Every control the trap's selector matches is removed from the dialog
    // first. `queryAllByRole('dialog')` is used for the post-condition because
    // after this point the dialog has no accessible name source left, which
    // would make the named lookup throw for an unrelated reason.
    render(<AIGenerateModal isOpen onClose={vi.fn()} />);
    await settle();

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const focusables = dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    );
    expect(focusables.length).toBeGreaterThan(0);
    focusables.forEach(el => el.remove());

    let notCancelled = true;
    await act(async () => {
      notCancelled = fireEvent.keyDown(document, { key: 'Tab', cancelable: true });
    });

    expect(notCancelled).toBe(true);
    expect(screen.queryAllByRole('dialog')).toHaveLength(1);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('ignores a key it does not handle', async () => {
    // Regression: the handler's `if (event.key !== 'Tab') return` bail-out. The
    // listener is on `document`, so it sees every keystroke made anywhere while
    // the modal is open — including keystrokes aimed at the textarea. Without
    // the bail-out, pressing Enter or an arrow key to edit a prompt would be
    // treated as focus-trap traffic.
    const onClose = vi.fn();
    render(<AIGenerateModal isOpen onClose={onClose} />);
    await settle();

    const textarea = screen.getByLabelText('Describe your diagram');
    textarea.focus();

    let notCancelled = true;
    await act(async () => {
      notCancelled = fireEvent.keyDown(document, { key: 'Enter', cancelable: true });
    });

    expect(notCancelled).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(textarea);
  });

  it('removes its keydown listener when the modal closes', async () => {
    // Regression: asserted on `removeEventListener` rather than on behaviour
    // after unmount, because a leaked listener is invisible once nothing
    // renders — a document-level Escape handler surviving the modal would keep
    // swallowing Escape for the whole canvas behind it.
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { unmount } = render(<AIGenerateModal isOpen onClose={vi.fn()} />);
    await settle();

    unmount();

    const removed = removeSpy.mock.calls.filter(call => call[0] === 'keydown');
    expect(removed.length).toBeGreaterThanOrEqual(1);
  });

  it('moves focus into the dialog on open and hands it back on close', async () => {
    // Regression: focus is captured before the dialog takes it and restored in
    // the effect cleanup. Without the restore, a keyboard user is dropped at
    // the top of the document every time the modal closes.
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { unmount } = render(<AIGenerateModal isOpen onClose={vi.fn()} />);
    await settle();
    await act(async () => {
      vi.advanceTimersByTime(32);
    });
    await settle();

    expect(document.activeElement).toBe(screen.getByRole('dialog'));

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

function dialogNode(): HTMLElement {
  return screen.getByRole('dialog');
}

describe('AIGenerateModal chrome', () => {
  it('fills the prompt from an example and clears the previous error', async () => {
    // Regression: picking an example is a two-in-one action. If it left a stale
    // error banner up, the user reads "Please enter a prompt" while staring at
    // a filled-in textarea.
    stubFetch({}, { ok: false, status: 400 });
    render(<AIGenerateModal isOpen onClose={vi.fn()} />);
    await settle();
    await submit();
    await settle();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    const example = /A decision tree for customer support/i;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: example }));
    });
    await settle();

    expect(screen.getByLabelText('Describe your diagram')).toHaveValue(
      'A decision tree for customer support'
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(generateButton()).toBeEnabled();
  });

  it('truncates a long example label rather than overflowing the row', async () => {
    // Regression: the `slice(0, 40) + '...'` branch, only reachable by an example
    // longer than 40 characters. `'A system architecture diagram with frontend,
    // backend, and database'` is 66 characters, so it takes the branch while the
    // other four examples do not — both arms asserted.
    render(<AIGenerateModal isOpen onClose={vi.fn()} />);
    await settle();

    expect(
      screen.getByRole('button', { name: 'A system architecture diagram with front...' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'A decision tree for customer support' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'A system architecture diagram with frontend, backend, and database',
      })
    ).toBeNull();
  });

  it('gives the close button its hover feedback', async () => {
    // Regression: the two inline style writes are the only hover affordance the
    // X has. A drop makes it a dead, indistinguishable control.
    const onClose = vi.fn();
    render(<AIGenerateModal isOpen onClose={onClose} />);
    await settle();

    const close = screen.getByRole('button', { name: 'Close AI diagram generator' });
    fireEvent.mouseEnter(close);
    expect(close.style.color).toBe('rgb(26, 25, 23)');
    fireEvent.mouseLeave(close);
    expect(close.style.color).toBe('rgb(107, 104, 96)');

    await act(async () => {
      fireEvent.click(close);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when the dialog body itself is clicked', async () => {
    // Regression: the panel stops propagation. Without it, clicking the prompt
    // label or any whitespace in the dialog closes the modal under the cursor.
    const onClose = vi.fn();
    render(<AIGenerateModal isOpen onClose={onClose} />);
    await settle();

    fireEvent.click(dialogNode());

    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders nothing while the exit animation has not started', async () => {
    // Regression: `isVisible` is what keeps a closed modal out of the DOM.
    // Returning markup anyway leaves an invisible overlay that swallows every
    // click on the canvas behind it.
    mockVisible = false;
    const { container } = render(<AIGenerateModal isOpen onClose={vi.fn()} />);
    await settle();

    expect(container).toBeEmptyDOMElement();
    expect(document.body.textContent).toBe('');
  });

  it('shows the store busy flag on mount if one was left set', async () => {
    // Regression: `aiGenerating` is read from the store, not local state, so a
    // modal opened while another part of the app believes a request is
    // outstanding must come up disabled rather than let a second one start.
    seedStore({ aiGenerating: true });
    stubFetch({ elements: [rect('gen')] });
    render(<AIGenerateModal isOpen onClose={vi.fn()} />);
    await settle();

    expect(generateButton()).toBeDisabled();
    expect(generateButton()).toHaveAttribute('aria-busy', 'true');
  });
});
