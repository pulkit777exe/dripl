import { describe, expect, it } from 'vitest';
import { resolveKeybinding, type KeybindingInput } from '@/lib/canvas/keybindings';

/**
 * The `readOnly` refusals in the keybinding table.
 *
 * `keybindings.ts` is a first-match chain, so a `readOnly` guard is reached only
 * if every branch above it declines. That makes each guard a distinct piece of
 * logic rather than a flag on a shared path, and the existing suite proves the
 * *allowed* side of most chords while leaving three refusals unexercised: Cmd/Ctrl+Y
 * redo, `[` send-backward, and `]` bring-forward.
 *
 * The property worth defending is not "these keys return null". It is the
 * classification: read-only refuses everything that mutates the scene and permits
 * everything that only reads it. Each test therefore asserts BOTH directions for
 * the same chord — a test that only asserted the refusal would pass just as well
 * if the chord had been deleted from the table entirely, which is exactly the
 * mistake the first bullet in each block is guarding against.
 */

const input = (key: string, extra: Partial<KeybindingInput> = {}): KeybindingInput => ({
  key,
  cmdOrCtrl: false,
  altKey: false,
  shiftKey: false,
  readOnly: false,
  hasSelection: true,
  ...extra,
});

/** Resolves to `null`, which is what the hook reads as "not my key". */
const refused = (key: string, extra: Partial<KeybindingInput> = {}): boolean =>
  resolveKeybinding(input(key, { readOnly: true, ...extra })) === null;

describe('redo is refused read-only, and undo with it', () => {
  it('refuses Cmd/Ctrl+Y but honours it with write access', () => {
    // Cmd/Ctrl+Z is the sibling branch and is already pinned by
    // `keybindings.test.ts`; redo is a separate guard one branch below and was
    // reachable only by the writable case.
    expect(resolveKeybinding(input('y', { cmdOrCtrl: true }))).toEqual({
      action: { kind: 'redo' },
      preventDefault: true,
    });
    expect(refused('y', { cmdOrCtrl: true })).toBe(true);
  });

  it('refuses redo under every modifier that still routes to the redo branch', () => {
    // The redo branch is `cmdOrCtrl && key === 'y'` with no shift test, so Shift
    // and Alt both land here. If a modifier combination were refused, the refusal
    // would have to come from a guard that would also refuse plain Cmd/Ctrl+Y —
    // which the test above already pins as honoured.
    expect(refused('y', { cmdOrCtrl: true, shiftKey: true })).toBe(true);
    expect(refused('y', { cmdOrCtrl: true, altKey: true })).toBe(true);
  });

  it('still refuses undo read-only, so the two history chords agree', () => {
    // Cross-check rather than a new claim: a table where redo is gated and undo
    // is not would let a read-only viewer rewrite history through Cmd/Ctrl+Z.
    expect(refused('z', { cmdOrCtrl: true })).toBe(true);
    expect(refused('z', { cmdOrCtrl: true, shiftKey: true })).toBe(true);
  });
});

describe('z-order keys are refused read-only', () => {
  it('refuses [ and ] with write access allowed, in both the plain and Cmd forms', () => {
    // The chord exists in four spellings and one `readOnly` guard covers all four,
    // since the guard precedes the plain/Cmd choice. The writable direction is
    // asserted first because it is what proves the chord is still in the table:
    // a deleted `[` branch returns null too, and would satisfy the refusal alone.
    expect(resolveKeybinding(input('['))?.action).toEqual({ kind: 'send-backward' });
    expect(resolveKeybinding(input('[', { cmdOrCtrl: true }))?.action).toEqual({
      kind: 'send-to-back',
    });
    expect(resolveKeybinding(input(']'))?.action).toEqual({ kind: 'bring-forward' });
    expect(resolveKeybinding(input(']', { cmdOrCtrl: true }))?.action).toEqual({
      kind: 'bring-to-front',
    });

    expect(refused('[')).toBe(true);
    expect(refused('[', { cmdOrCtrl: true })).toBe(true);
    expect(refused(']')).toBe(true);
    expect(refused(']', { cmdOrCtrl: true })).toBe(true);
  });

  it('does not gate z-order on having a selection', () => {
    // Recorded because it is the one mutation chord in the table that is gated on
    // `readOnly` alone. `delete` and `nudge` both require a selection as well, and
    // the asymmetry is real: the hook calls `store.sendBackward(ids)` with a
    // possibly-empty set, which is a no-op, so the guard is sound without one.
    // Pinned so that adding a `hasSelection` gate later is a visible change
    // rather than a silent one.
    expect(resolveKeybinding(input('[', { hasSelection: false }))?.action).toEqual({
      kind: 'send-backward',
    });
    expect(resolveKeybinding(input(']', { hasSelection: false }))?.action).toEqual({
      kind: 'bring-forward',
    });
    expect(refused('[', { hasSelection: false })).toBe(true);
  });

  it('refuses z-order even under Shift and Alt, which never changed the chord', () => {
    // The `[`/`]` branches ignore modifiers entirely, so these spellings resolve
    // identically to the bare ones — the point is that the read-only guard is
    // upstream of the modifier choice and cannot be side-stepped by holding a key.
    expect(refused('[', { shiftKey: true })).toBe(true);
    expect(refused('[', { altKey: true })).toBe(true);
    expect(refused(']', { shiftKey: true })).toBe(true);
    expect(refused(']', { altKey: true })).toBe(true);
  });
});

describe('read-only permits every chord that only reads', () => {
  it('keeps view, selection and clipboard-read chords available', () => {
    // The complement of the three refusals. Without this, "return null for
    // [ and ]" would be indistinguishable from "break keybindings for
    // read-only viewers", which is the failure a read-only mode actually causes
    // in practice: a shared view link is opened read-only and the user can no
    // longer copy or navigate.
    expect(resolveKeybinding(input('a', { cmdOrCtrl: true, readOnly: true }))?.action).toEqual({
      kind: 'select-all',
    });
    expect(resolveKeybinding(input('c', { cmdOrCtrl: true, readOnly: true }))?.action).toEqual({
      kind: 'copy',
    });
    expect(
      resolveKeybinding(input('c', { cmdOrCtrl: true, shiftKey: true, readOnly: true }))?.action
    ).toEqual({ kind: 'copy-style' });
    expect(resolveKeybinding(input('f', { cmdOrCtrl: true, readOnly: true }))?.action).toEqual({
      kind: 'find',
    });
    expect(
      resolveKeybinding(input('f', { cmdOrCtrl: true, shiftKey: true, readOnly: true }))?.action
    ).toEqual({ kind: 'fit' });
    expect(resolveKeybinding(input('0', { cmdOrCtrl: true, readOnly: true }))?.action).toEqual({
      kind: 'fit',
    });
    expect(
      resolveKeybinding(input('h', { cmdOrCtrl: true, shiftKey: true, readOnly: true }))?.action
    ).toEqual({ kind: 'reset-view' });
    expect(
      resolveKeybinding(input('g', { cmdOrCtrl: true, altKey: true, readOnly: true }))?.action
    ).toEqual({ kind: 'toggle-grid' });
  });

  it('keeps zoom, escape, tool selection and deletion-by-selection decisions intact', () => {
    // Zoom and tool selection are gated on nothing at all, and `escape` is
    // deliberately `preventDefault: false` even read-only because cancelling is
    // not a mutation. Deletion is the interesting one: it stays refused, but for
    // its own `hasSelection` guard as well as `readOnly`.
    expect(resolveKeybinding(input('+', { readOnly: true }))?.action).toEqual({ kind: 'zoom-in' });
    expect(resolveKeybinding(input('-', { readOnly: true }))?.action).toEqual({
      kind: 'zoom-out',
    });
    expect(resolveKeybinding(input('r', { readOnly: true }))).toEqual({
      action: { kind: 'tool', tool: 'rectangle' },
      preventDefault: false,
    });
    expect(resolveKeybinding(input('escape', { readOnly: true }))).toEqual({
      action: { kind: 'escape' },
      preventDefault: false,
    });
    expect(refused('delete')).toBe(true);
    expect(refused('backspace')).toBe(true);
    expect(refused('arrowup')).toBe(true);
    // Style *paste* writes, so unlike style *copy* it stays refused.
    expect(refused('v', { cmdOrCtrl: true, shiftKey: true })).toBe(true);
    // Plain paste and duplicate write too.
    expect(refused('v', { cmdOrCtrl: true })).toBe(true);
    expect(refused('d', { cmdOrCtrl: true })).toBe(true);
    // Grouping writes.
    expect(refused('g', { cmdOrCtrl: true })).toBe(true);
    expect(refused('g', { cmdOrCtrl: true, shiftKey: true })).toBe(true);
  });
});
