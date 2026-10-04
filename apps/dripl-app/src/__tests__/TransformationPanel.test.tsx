import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { DriplElement } from '@dripl/common';
import { TransformationPanel } from '@/components/canvas/TransformationPanel';

/**
 * `TransformationPanel` had **no tests at all** — 44 of 44 statements
 * unexecuted — and it is the only property editor in the canvas, so every
 * handler in it writes user data.
 *
 * Scope note, because it changes what these tests can claim: this component is
 * purely presentational. It takes a single `selectedElement` plus three
 * callbacks and never imports the store, so multi-select fan-out, collaborator
 * locks (`elementLocks`), history/undo, and tombstone checks are **not** this
 * file's behaviour — they belong to a caller, and `TransformationPanel` has no
 * importer anywhere in the app at the time of writing. What *is* here, and what
 * is pinned below, is the component's own contract: what it writes, what it
 * refuses to write, and which element it hands to which callback.
 *
 * Every test asserts the negative alongside the positive: an editor that
 * silently drops a field or writes through a no-op is the failure mode that
 * matters, and none of it is visible from the rendered output alone.
 */

function element(extra: Partial<DriplElement> = {}): DriplElement {
  return {
    id: 'el-1',
    type: 'rectangle',
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    strokeColor: '#000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    ...extra,
  } as unknown as DriplElement;
}

/**
 * Typed as the component's actual prop signatures rather than
 * `ReturnType<typeof vi.fn>`, which erases them to `Mock<Procedure |
 * Constructable>` and is not assignable to the props. Carrying the signature also
 * makes the mocks stricter: a test that calls `onUpdateElement()` with the wrong
 * shape is now a type error rather than a silent no-op assertion.
 */
interface Handlers {
  onUpdateElement: Mock<(element: DriplElement) => void>;
  onDeleteElement: Mock<(elementId: string) => void>;
  onDuplicateElement: Mock<(element: DriplElement) => void>;
}

function setup(selected: DriplElement | null) {
  const handlers: Handlers = {
    onUpdateElement: vi.fn<(element: DriplElement) => void>(),
    onDeleteElement: vi.fn<(elementId: string) => void>(),
    onDuplicateElement: vi.fn<(element: DriplElement) => void>(),
  };
  const view = render(
    <TransformationPanel
      selectedElement={selected}
      onUpdateElement={handlers.onUpdateElement}
      onDeleteElement={handlers.onDeleteElement}
      onDuplicateElement={handlers.onDuplicateElement}
    />
  );
  return { ...view, ...handlers };
}

/** Numeric inputs in DOM order: X, Y, W, H, rotation. */
function numberInputs(root: HTMLElement): HTMLInputElement[] {
  return Array.from(root.querySelectorAll<HTMLInputElement>('input[type="number"]'));
}

function linkInput(root: HTMLElement): HTMLInputElement {
  return root.querySelector<HTMLInputElement>('input[type="url"]')!;
}

/** The flip buttons carry no text or title, so they are found by their icon. */
function flipButton(root: HTMLElement, icon: 'arrow-left-right' | 'arrow-up-down'): HTMLElement {
  const svg = root.querySelector(`[class*="lucide-${icon}"]`);
  if (!svg) throw new Error(`no ${icon} icon rendered`);
  return svg.closest('button')!;
}

function byText(root: HTMLElement, label: string): HTMLElement {
  const match = Array.from(root.querySelectorAll('button')).find(
    b => b.textContent?.trim() === label
  );
  if (!match) throw new Error(`no button labelled ${label}`);
  return match;
}

/** The argument of the single `onUpdateElement` call, or a thrown error. */
function updated(handlers: Handlers): DriplElement {
  if (handlers.onUpdateElement.mock.calls.length !== 1) {
    throw new Error(
      `expected exactly one onUpdateElement call, got ${handlers.onUpdateElement.mock.calls.length}`
    );
  }
  return handlers.onUpdateElement.mock.calls[0]![0] as DriplElement;
}

let openSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
});

afterEach(() => {
  openSpy.mockRestore();
  vi.clearAllMocks();
});

describe('TransformationPanel with nothing selected', () => {
  it('renders nothing at all, so no control can act on an empty set', () => {
    // Regression: the `if (!selectedElement) return null` gate. Without it the
    // panel would render Delete, Duplicate and Lock against `undefined` — the
    // user gets an actionable-looking panel for an empty selection, and Delete
    // would call `onDeleteElement(undefined.id)`.
    const { container } = setup(null);

    expect(container).toBeEmptyDOMElement();
    expect(container.querySelectorAll('input')).toHaveLength(0);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('calls no callback on mount', () => {
    // Regression: the control for the test above. A mount-time side effect
    // (normalising a default, clearing a lock) would be invisible in the DOM but
    // would write to the store before the user touched anything.
    const handlers = setup(element());

    expect(handlers.onUpdateElement).not.toHaveBeenCalled();
    expect(handlers.onDeleteElement).not.toHaveBeenCalled();
    expect(handlers.onDuplicateElement).not.toHaveBeenCalled();
  });
});

describe('TransformationPanel numeric fields', () => {
  it('writes the new X and carries every other field through unchanged', () => {
    // Regression: `updateProperty` spreads the whole element. A version that
    // sent only the changed key — or rebuilt the element from a subset — would
    // drop `strokeColor`, `opacity`, `roughness` and the rest, silently
    // resetting the element's styling on the first nudge.
    const handlers = setup(element({ rotation: 30, opacity: 0.5 }));

    fireEvent.change(numberInputs(handlers.container)[0]!, { target: { value: '42' } });

    const next = updated(handlers);
    expect(next.x).toBe(42);
    expect(next).toMatchObject({
      id: 'el-1',
      type: 'rectangle',
      y: 20,
      width: 100,
      height: 50,
      strokeColor: '#000',
      opacity: 0.5,
      rotation: 30,
    });
    expect(handlers.onDeleteElement).not.toHaveBeenCalled();
    expect(handlers.onDuplicateElement).not.toHaveBeenCalled();
  });

  it('rounds the displayed position so a fractional element is not shown as a decimal', () => {
    // Regression: the inputs render `Math.round(...)`, not the raw float. A
    // sub-pixel element at x=10.6 shown as "10.6" invites the user to "fix" it
    // to a wrong whole number, and 10.6 is not a value the canvas ever stores.
    const handlers = setup(element({ x: 10.6, y: 20.4 }));

    const [x, y] = numberInputs(handlers.container);
    expect(x!.value).toBe('11');
    expect(y!.value).toBe('20');
  });

  it('writes 0 — not NaN — when a numeric field is cleared', () => {
    // Pinned as the source actually behaves, and this is a finding rather than a
    // recommendation: there is **no** validation on these inputs. `Number('')`
    // is 0, so clearing the X field snaps the element to x=0. The realistic bad
    // write is 0, not NaN, because a number input sanitises non-numeric text
    // away before the handler ever sees it.
    //
    // The regression this catches: swapping `Number(...)` for `parseFloat(...)`
    // writes `NaN` into a stored element, which then propagates into every
    // derived value (hit testing, bounds, export) as a silent `NaN`.
    const handlers = setup(element({ x: 10, y: 20 }));

    fireEvent.change(numberInputs(handlers.container)[0]!, { target: { value: '' } });

    const next = updated(handlers);
    expect(Number.isNaN(next.x)).toBe(false);
    expect(next.x).toBe(0);
    // Y is untouched: clearing one field must not write through to its sibling.
    expect(next.y).toBe(20);
  });

  it('keeps the size minimum in the markup only, not in what it writes', () => {
    // Pinned as documentation of a gap, not an endorsement: `min="1"` on W and H
    // is an HTML hint the browser shows as a validation bubble; nothing clamps
    // the value before it reaches the store, so a scripted or pasted 0 goes
    // straight through. If a clamp is ever added, this is the test that says the
    // behaviour changed.
    const handlers = setup(element({ width: 100, height: 50 }));

    const [, , w, h] = numberInputs(handlers.container);
    expect(w!.getAttribute('min')).toBe('1');
    expect(h!.getAttribute('min')).toBe('1');

    fireEvent.change(w!, { target: { value: '0' } });
    expect(updated(handlers).width).toBe(0);
  });

  it('writes Y, W and H through the same single-key path', () => {
    // Regression: the control for the X test above, for the remaining three
    // numeric fields. A copy-paste that wired one of them to the wrong key —
    // `height` writing into `width`, say — would be invisible in the rendered
    // panel and would resize the element along the wrong axis.
    const cases: { index: number; value: string; key: 'y' | 'width' | 'height' }[] = [
      { index: 1, value: '77', key: 'y' },
      { index: 2, value: '321', key: 'width' },
      { index: 3, value: '123', key: 'height' },
    ];

    for (const { index, value, key } of cases) {
      const handlers = setup(element());
      fireEvent.change(numberInputs(handlers.container)[index]!, { target: { value } });

      const next = updated(handlers);
      expect(next[key]).toBe(Number(value));
      // Every sibling key is untouched.
      expect(next.x).toBe(10);
      expect(next.y).toBe(key === 'y' ? Number(value) : 20);
      expect(next.width).toBe(key === 'width' ? Number(value) : 100);
      expect(next.height).toBe(key === 'height' ? Number(value) : 50);
    }
  });

  it('toggles the vertical flip between -1 and 1', () => {
    // Regression: the other ternary arm of the flip handlers. Pressing the
    // vertical arrow on an already-flipped element must flip it *back*; a
    // one-way toggle would make the control useless after one use.
    const handlers = setup(element({ flipVertical: -1 }));

    fireEvent.click(flipButton(handlers.container, 'arrow-up-down'));

    expect(updated(handlers).flipVertical).toBe(1);
  });

  it('writes rotation typed into the rotation field', () => {
    // Regression: the rotation input is a plain `onChange` write, separate from
    // the rotate button. If it wrote the button's `+45` result instead of the
    // typed value, the field would fight the user on every keystroke.
    const handlers = setup(element({ rotation: 10 }));

    fireEvent.change(numberInputs(handlers.container)[4]!, { target: { value: '123' } });

    expect(updated(handlers).rotation).toBe(123);
  });
});

describe('TransformationPanel rotate and flip', () => {
  it('rotates by 45 degrees at a time, accumulating from zero', () => {
    // Regression: `rotation ?? 0` then `+45`, applied to the *element's* value
    // each time. A version that reset to 45 on every press would make the button
    // useless after the first click.
    const handlers = setup(element());

    fireEvent.click(handlers.container.querySelector('[title="Rotate 45 degrees"]')!);
    expect(updated(handlers).rotation).toBe(45);

    // Second press needs the element to come back with the first result, which
    // is the caller's job — so re-render with the updated element.
    const next = element({ rotation: 45 });
    const second = setup(next);
    fireEvent.click(second.container.querySelector('[title="Rotate 45 degrees"]')!);
    expect(updated(second).rotation).toBe(90);
  });

  it('accumulates onto an existing rotation rather than resetting it', () => {
    // Regression: the `?? 0` default must not win over a real value. Reading
    // `selectedElement.rotation` as if it were absent would snap a rotated
    // element back to 45 degrees.
    const handlers = setup(element({ rotation: 30 }));

    fireEvent.click(handlers.container.querySelector('[title="Rotate 45 degrees"]')!);

    expect(updated(handlers).rotation).toBe(75);
  });

  it('does not wrap rotation at 360', () => {
    // Pinned as the source behaves: 350 + 45 is 395, with no modulo. The number
    // field declares `max="360"`, so this is a genuine inconsistency between
    // what the panel stores and what its own markup advertises. If the wrap is
    // ever added, this test is what says so.
    const handlers = setup(element({ rotation: 350 }));

    fireEvent.click(handlers.container.querySelector('[title="Rotate 45 degrees"]')!);

    expect(updated(handlers).rotation).toBe(395);
  });

  it('toggles the horizontal flip between 1 and -1', () => {
    // Regression: `flipHorizontal ?? 1` then `currentFlip === 1 ? -1 : 1`. With
    // an unset flag the first press must flip *on* (-1) rather than store the
    // default 1, which would look like the button did nothing.
    const handlers = setup(element());

    fireEvent.click(flipButton(handlers.container, 'arrow-left-right'));
    expect(updated(handlers).flipHorizontal).toBe(-1);

    const second = setup(element({ flipHorizontal: -1 }));
    fireEvent.click(flipButton(second.container, 'arrow-left-right'));
    expect(updated(second).flipHorizontal).toBe(1);
  });

  it('toggles the vertical flip without disturbing the horizontal one', () => {
    // Regression: the negative for each flip button. They write different keys,
    // and a copy-paste that wrote `flipHorizontal` from both would silently
    // un-flip a horizontally-flipped element every time the user pressed the
    // other arrow.
    const handlers = setup(element({ flipHorizontal: -1 }));

    fireEvent.click(flipButton(handlers.container, 'arrow-up-down'));

    const next = updated(handlers);
    expect(next.flipVertical).toBe(-1);
    expect(next.flipHorizontal).toBe(-1);
  });

  it('leaves the horizontal flip alone when the vertical one is pressed', () => {
    // Regression: the control for the test above, from the other direction — an
    // unset horizontal flip must stay unset rather than being written as 1.
    const handlers = setup(element());

    fireEvent.click(flipButton(handlers.container, 'arrow-up-down'));

    expect(updated(handlers).flipHorizontal).toBeUndefined();
  });
});

describe('TransformationPanel lock', () => {
  it('locks an unlocked element', () => {
    // Regression: `!selectedElement.locked` on an element with no `locked` field
    // must yield `true`. A `locked === true` style check would leave an
    // unannotated element un-lockable forever.
    const handlers = setup(element());

    fireEvent.click(byText(handlers.container, 'Lock'));

    expect(updated(handlers).locked).toBe(true);
  });

  it('unlocks a locked element', () => {
    // Regression: the toggle's other arm, which a `locked = true` version would
    // lose — making Lock a one-way door.
    const handlers = setup(element({ locked: true }));

    fireEvent.click(byText(handlers.container, 'Lock'));

    expect(updated(handlers).locked).toBe(false);
  });

  it('does not touch the other element fields when locking', () => {
    // Regression: `updateProperty` spreads the element, so Lock must be a pure
    // one-key write. A version that rebuilt the element would drop `link`.
    const handlers = setup(element({ link: 'https://example.com' }));

    fireEvent.click(byText(handlers.container, 'Lock'));

    expect(updated(handlers).link).toBe('https://example.com');
  });
});

describe('TransformationPanel delete and duplicate', () => {
  it('deletes by element id and writes nothing', () => {
    // Regression: `onDeleteElement(selectedElement.id)` — the **id**, matching
    // the callback's own signature. Passing the element instead would make the
    // caller's `delete(id)` look up `[object Object]` and silently delete
    // nothing, so the button would appear broken with no error.
    const handlers = setup(element({ rotation: 45 }));

    fireEvent.click(byText(handlers.container, 'Delete'));

    expect(handlers.onDeleteElement).toHaveBeenCalledTimes(1);
    expect(handlers.onDeleteElement).toHaveBeenCalledWith('el-1');
    expect(handlers.onUpdateElement).not.toHaveBeenCalled();
    expect(handlers.onDuplicateElement).not.toHaveBeenCalled();
  });

  it('duplicates the element itself, not just its id', () => {
    // Regression: `onDuplicateElement(selectedElement)` — the opposite shape from
    // delete. A copy-paste that passed the id here would duplicate a blank
    // element, since the caller has no store to look the id back up in.
    const source = element({ rotation: 45, link: 'https://example.com' });
    const handlers = setup(source);

    fireEvent.click(byText(handlers.container, 'Duplicate'));

    expect(handlers.onDuplicateElement).toHaveBeenCalledTimes(1);
    expect(handlers.onDuplicateElement).toHaveBeenCalledWith(source);
    expect(handlers.onUpdateElement).not.toHaveBeenCalled();
    expect(handlers.onDeleteElement).not.toHaveBeenCalled();
  });

  it('acts on the selected element id when the selection changes', () => {
    // Regression: the handlers read `selectedElement` from props on every
    // render. Capturing the id once in a ref or a mount-time closure would make
    // Delete remove the previously-selected element — the worst kind of panel
    // bug, because the wrong thing is destroyed.
    const handlers = setup(element());
    handlers.rerender(
      <TransformationPanel
        selectedElement={element({ id: 'el-2' })}
        onUpdateElement={handlers.onUpdateElement}
        onDeleteElement={handlers.onDeleteElement}
        onDuplicateElement={handlers.onDuplicateElement}
      />
    );

    fireEvent.click(byText(handlers.container, 'Delete'));

    expect(handlers.onDeleteElement).toHaveBeenCalledWith('el-2');
  });
});

describe('TransformationPanel link editor', () => {
  it('prefixes a bare domain with https when the field is committed', () => {
    // Regression: `normalizeLinkInput` prepends the scheme so a pasted
    // `example.com` works. Without it the link is stored scheme-less, is judged
    // unsafe by `isSafeHttpUrl`, and the user is told their own link is invalid.
    const handlers = setup(element());

    fireEvent.change(linkInput(handlers.container), { target: { value: 'example.com' } });
    fireEvent.focusOut(linkInput(handlers.container));

    expect(updated(handlers).link).toBe('https://example.com');
  });

  it('commits on Enter as well as on blur', () => {
    // Regression: Enter is the keyboard route to commit. Without it, a keyboard
    // user tabs past the field and the typed link is discarded on blur-refocus.
    const handlers = setup(element());
    const input = linkInput(handlers.container);

    fireEvent.change(input, { target: { value: 'https://example.com' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(updated(handlers).link).toBe('https://example.com');
  });

  it('writes nothing when the committed link is unchanged', () => {
    // Regression: `if (!normalized.changed) return`. `normalizeLinkInput`
    // returns `{changed: false, value: undefined}` for a no-op edit, so a panel
    // that ignored the flag would call `updateProperty('link', undefined)` on
    // every focus/blur cycle — **erasing the user's link** by touching a field
    // without typing in it.
    const handlers = setup(element({ link: 'https://example.com' }));
    const input = linkInput(handlers.container);

    expect(input.value).toBe('https://example.com');
    fireEvent.focusOut(input);

    expect(handlers.onUpdateElement).not.toHaveBeenCalled();
  });

  it('removes the link when the field is cleared', () => {
    // Regression: the empty-string arm of `normalizeLinkInput`, which clears
    // rather than storing `''`. A stored empty string would render as a
    // present-but-empty link, keeping the Open/Remove controls on screen.
    const handlers = setup(element({ link: 'https://example.com' }));
    const input = linkInput(handlers.container);

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.focusOut(input);

    const next = updated(handlers);
    expect(next.link).toBeUndefined();
    expect('link' in next && next.link === '').toBe(false);
  });

  it('discards the in-progress draft when the selection changes', () => {
    // Regression: the draft is keyed by element id
    // (`linkDraft.id === selectedElement.id`). A draft that survived the
    // selection change would be committed onto the *newly* selected element —
    // pasting one element's link onto another by accident.
    const handlers = setup(element({ id: 'el-1' }));
    fireEvent.change(linkInput(handlers.container), { target: { value: 'https://typed.com' } });
    expect(linkInput(handlers.container).value).toBe('https://typed.com');

    handlers.rerender(
      <TransformationPanel
        selectedElement={element({ id: 'el-2', link: 'https://original.com' })}
        onUpdateElement={handlers.onUpdateElement}
        onDeleteElement={handlers.onDeleteElement}
        onDuplicateElement={handlers.onDuplicateElement}
      />
    );

    expect(linkInput(handlers.container).value).toBe('https://original.com');
  });

  it('keeps the draft when the same element is re-rendered', () => {
    // Regression: the control for the test above. Re-rendering with the *same*
    // id — which happens on every unrelated store write, such as the panel
    // re-rendering after a drag — must not throw away what the user is typing.
    const handlers = setup(element({ id: 'el-1' }));
    fireEvent.change(linkInput(handlers.container), { target: { value: 'https://typed.com' } });

    handlers.rerender(
      <TransformationPanel
        selectedElement={element({ id: 'el-1' })}
        onUpdateElement={handlers.onUpdateElement}
        onDeleteElement={handlers.onDeleteElement}
        onDuplicateElement={handlers.onDuplicateElement}
      />
    );

    expect(linkInput(handlers.container).value).toBe('https://typed.com');
  });

  it('opens a safe link in a new tab with the opener locked down', () => {
    // Regression: `_blank` without `noopener` hands the opened page a live
    // `window.opener` reference to the canvas — the standard reverse-tabnabbing
    // hole. The third argument is not decoration.
    const handlers = setup(element({ link: 'https://example.com' }));

    fireEvent.click(screen_openButton(handlers.container));

    expect(window.open).toHaveBeenCalledWith(
      'https://example.com',
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('keeps an unsafe scheme on the element but refuses to open it', () => {
    // Regression: `javascript:` is *stored*, deliberately, so a collaborator can
    // fix it — but `isSafeHttpUrl` gates the Open button and the panel says so.
    // The other half of this assertion is the negative that matters: the link
    // must not be silently dropped, and `window.open` must not be called.
    const handlers = setup(element({ link: 'javascript:alert(1)' }));

    const openButton = screen_openButton(handlers.container);
    expect(openButton).toBeDisabled();
    expect(handlers.container.textContent).toMatch(/Only http\(s\) links are kept on export/i);

    fireEvent.click(openButton);
    expect(window.open).not.toHaveBeenCalled();
  });

  it('opens the committed link, never an unsafe draft typed over it', () => {
    // Regression: the unsafe-draft half of the same ternary. The user has a good
    // link on the element and has just typed a `javascript:` URL into the field.
    // The Open control must go disabled rather than offering to launch the URL
    // the panel itself calls unsafe.
    const handlers = setup(element({ link: 'https://example.com' }));
    const input = linkInput(handlers.container);
    fireEvent.change(input, { target: { value: 'javascript:alert(1)' } });

    expect(screen_openButton(handlers.container)).toBeDisabled();
    expect(window.open).not.toHaveBeenCalled();
  });

  it('opens the typed draft when it is safe, and only then', () => {
    // Regression: the live arm of
    // `const candidate = linkIsSafe && linkValue !== '' ? linkValue : committedLink`.
    // A safe uncommitted draft is what gets opened, and the unsafe-draft case
    // above shows the control that keeps `javascript:` out of `window.open`.
    //
    // The *other* arm (`: committedLink`) is unreachable rather than untested:
    // the button carries `disabled={!linkIsSafe}`, so a click can only arrive
    // when `linkIsSafe` is true and the ternary always takes `linkValue`. The
    // `isSafeHttpUrl(candidate)` re-check below it is dead for the same reason.
    const handlers = setup(element({ link: 'https://example.com' }));
    const input = linkInput(handlers.container);
    fireEvent.change(input, { target: { value: 'https://typed.com' } });

    const openButton = screen_openButton(handlers.container);
    expect(openButton).toBeEnabled();
    fireEvent.click(openButton);

    expect(window.open).toHaveBeenCalledWith('https://typed.com', '_blank', 'noopener,noreferrer');
  });

  it('disables Open outright when the element carries an unsafe committed link', () => {
    // Regression: with no draft, `linkValue` *is* `committedLink`, so an unsafe
    // link arriving from a collaborator makes the control disabled rather than
    // merely warning — there is no click that could launch it.
    const handlers = setup(element({ link: 'javascript:alert(1)' }));

    const openButton = screen_openButton(handlers.container);
    expect(openButton).toBeDisabled();
    expect(openButton).toHaveAttribute('title', 'Only http(s) links can be opened');

    fireEvent.click(openButton);
    expect(window.open).not.toHaveBeenCalled();
  });

  it('does not commit the link for a key other than Enter', () => {
    // Regression: the `e.key === 'Enter'` guard on the link field. Without it
    // every keystroke typed into the URL box would commit, spamming the history
    // with one entry per character — the exact reason the draft exists.
    const handlers = setup(element());
    const input = linkInput(handlers.container);

    fireEvent.change(input, { target: { value: 'https://example.com' } });
    fireEvent.keyDown(input, { key: 'a' });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(handlers.onUpdateElement).not.toHaveBeenCalled();
    expect(input.value).toBe('https://example.com');
  });

  it('hides the open and remove controls entirely when there is no link', () => {
    // Regression: the `committedLink !== ''` guard. Offering an Open button with
    // nothing to open is a dead control, and a Remove button with no link
    // invites a pointless write on a panel where the user has not linked
    // anything.
    const handlers = setup(element());

    // `querySelector` is typed `Element | null`; this is a button. The cast is
    // checked by the uses below rather than being an unchecked escape.
    expect(handlers.container.querySelector<HTMLElement>('[aria-label="Open link"]')).toBeNull();
    expect(handlers.container.querySelector('[aria-label="Remove link"]')).toBeNull();
    expect(handlers.container.textContent).not.toMatch(/Only http\(s\)/i);
  });

  it('removes the link and drops the draft in one action', () => {
    // Regression: Remove sets `link: undefined` *and* clears the draft.
    //
    // The panel is controlled, so the input cannot visibly empty until the
    // parent passes back an element with no link — which is why the observable
    // half of this assertion is that the input falls back to the *committed*
    // link rather than showing the typed draft. A version that cleared
    // `link` but left `linkDraft` in place would keep showing the URL the user
    // just deleted, and would re-commit it on the next blur.
    const handlers = setup(element({ link: 'https://example.com' }));
    const input = linkInput(handlers.container);
    fireEvent.change(input, { target: { value: 'https://typed.com' } });

    fireEvent.click(handlers.container.querySelector('[aria-label="Remove link"]')!);

    expect(updated(handlers).link).toBeUndefined();
    expect(linkInput(handlers.container).value).toBe('https://example.com');
  });
});

function screen_openButton(root: HTMLElement): HTMLElement {
  // `querySelector` is typed `Element | null`; this is a button. The generic
  // narrows it rather than casting past the check.
  const match = root.querySelector<HTMLElement>('[aria-label="Open link"]');
  if (!match) throw new Error('no Open link control rendered');
  return match;
}

describe('TransformationPanel rendering', () => {
  it('shows no warning for an empty link field', () => {
    // Regression: the warning's guard is `linkValue !== '' && !linkIsSafe`. An
    // empty field is "safe" (`linkValue === ''` short-circuits `linkIsSafe`),
    // so without the `linkValue` guard the panel would greet a user who has not
    // typed anything with a red "only http(s) links are kept" warning.
    const handlers = setup(element());

    expect(handlers.container.textContent).not.toMatch(/Only http\(s\)/i);
  });

  it('marks an active flip and an active lock in its own styling', () => {
    // Regression: the `=== -1` and truthiness class names. These are the only
    // feedback that a flip or lock is on — if the class stopped reflecting
    // state, the panel would look identical flipped and unflipped.
    //
    // Asserted as the exact two-class pair rather than a substring: the inactive
    // variant carries `hover:bg-accent`, which contains the active class name as
    // a substring and would satisfy a looser check.
    const ACTIVE = 'bg-accent text-accent-foreground';
    const off = setup(element());
    const on = setup(element({ flipHorizontal: -1, locked: true }));

    expect(flipButton(off.container, 'arrow-left-right').className).not.toContain(ACTIVE);
    expect(flipButton(on.container, 'arrow-left-right').className).toContain(ACTIVE);
    expect(byText(off.container, 'Lock').className).not.toContain(ACTIVE);
    expect(byText(on.container, 'Lock').className).toContain(ACTIVE);
  });
});
