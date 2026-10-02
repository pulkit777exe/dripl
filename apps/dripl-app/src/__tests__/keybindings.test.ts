import { describe, expect, it } from 'vitest';
import {
  LETTER_TOOLS,
  NUMERIC_TOOLS,
  resolveKeybinding,
  type KeybindingInput,
} from '@/lib/canvas/keybindings';

const plain = (key: string, extra: Partial<KeybindingInput> = {}): KeybindingInput => ({
  key,
  cmdOrCtrl: false,
  altKey: false,
  shiftKey: false,
  readOnly: false,
  hasSelection: true,
  ...extra,
});

const cmd = (key: string, extra: Partial<KeybindingInput> = {}): KeybindingInput => ({
  ...plain(key),
  cmdOrCtrl: true,
  ...extra,
});

describe('resolveKeybinding tools', () => {
  it('maps letters without preventDefault', () => {
    expect(resolveKeybinding(plain('r'))).toEqual({
      action: { kind: 'tool', tool: 'rectangle' },
      preventDefault: false,
    });
    expect(resolveKeybinding(plain('o'))?.action).toEqual({ kind: 'tool', tool: 'ellipse' });
  });

  it('maps digits with preventDefault', () => {
    expect(resolveKeybinding(plain('1'))).toEqual({
      action: { kind: 'tool', tool: 'select' },
      preventDefault: true,
    });
  });

  it('exposes full tool tables', () => {
    expect(Object.keys(LETTER_TOOLS)).toContain('v');
    expect(NUMERIC_TOOLS['9']).toBe('image');
  });

  it('returns null for unbound keys', () => {
    expect(resolveKeybinding(plain('q'))).toBeNull();
  });
});

describe('resolveKeybinding history and clipboard', () => {
  it('undoes, redoes on shift, and gates on readOnly', () => {
    expect(resolveKeybinding(cmd('z'))?.action).toEqual({ kind: 'undo' });
    expect(resolveKeybinding(cmd('z', { shiftKey: true }))?.action).toEqual({ kind: 'redo' });
    expect(resolveKeybinding(cmd('z', { readOnly: true }))).toBeNull();
    expect(resolveKeybinding(cmd('y'))?.action).toEqual({ kind: 'redo' });
  });

  it('selects all even when read-only', () => {
    expect(resolveKeybinding(cmd('a', { readOnly: true }))?.action).toEqual({
      kind: 'select-all',
    });
  });

  it('gates paste/duplicate on readOnly but not copy', () => {
    expect(resolveKeybinding(cmd('v', { readOnly: true }))).toBeNull();
    expect(resolveKeybinding(cmd('d', { readOnly: true }))).toBeNull();
    expect(resolveKeybinding(cmd('c', { readOnly: true }))?.action).toEqual({ kind: 'copy' });
  });
});

describe('resolveKeybinding fit precedence', () => {
  it('prefers fit over find for Cmd+Shift+F', () => {
    expect(resolveKeybinding(cmd('f', { shiftKey: true }))?.action).toEqual({ kind: 'fit' });
    expect(resolveKeybinding(cmd('f'))?.action).toEqual({ kind: 'find' });
    expect(resolveKeybinding(cmd('0'))?.action).toEqual({ kind: 'fit' });
  });
});

describe('resolveKeybinding arrange and view', () => {
  it('groups, ungroups on shift, gates on readOnly', () => {
    expect(resolveKeybinding(cmd('g'))?.action).toEqual({ kind: 'group' });
    expect(resolveKeybinding(cmd('g', { shiftKey: true }))?.action).toEqual({ kind: 'ungroup' });
    expect(resolveKeybinding(cmd('g', { readOnly: true }))).toBeNull();
  });

  it('toggles grid with Cmd+Alt+G regardless of readOnly', () => {
    expect(resolveKeybinding(cmd('g', { altKey: true }))?.action).toEqual({
      kind: 'toggle-grid',
    });
  });

  it('sends backward by default, to back with Cmd', () => {
    expect(resolveKeybinding(plain('['))?.action).toEqual({ kind: 'send-backward' });
    expect(resolveKeybinding(cmd('['))?.action).toEqual({ kind: 'send-to-back' });
    expect(resolveKeybinding(plain(']'))?.action).toEqual({ kind: 'bring-forward' });
    expect(resolveKeybinding(cmd(']'))?.action).toEqual({ kind: 'bring-to-front' });
  });

  it('zooms and resets the view', () => {
    expect(resolveKeybinding(plain('+'))?.action).toEqual({ kind: 'zoom-in' });
    expect(resolveKeybinding(plain('-'))?.action).toEqual({ kind: 'zoom-out' });
    expect(resolveKeybinding(cmd('h', { shiftKey: true }))?.action).toEqual({
      kind: 'reset-view',
    });
  });
});

describe('resolveKeybinding delete and escape', () => {
  it('deletes only with a selection and write access', () => {
    expect(resolveKeybinding(plain('delete'))?.action).toEqual({ kind: 'delete-selection' });
    expect(resolveKeybinding(plain('backspace'))?.action).toEqual({
      kind: 'delete-selection',
    });
    expect(resolveKeybinding(plain('delete', { hasSelection: false }))).toBeNull();
    expect(resolveKeybinding(plain('delete', { readOnly: true }))).toBeNull();
  });

  it('escapes without preventDefault', () => {
    expect(resolveKeybinding(plain('escape'))).toEqual({
      action: { kind: 'escape' },
      preventDefault: false,
    });
  });
});

describe('resolveKeybinding style clipboard', () => {
  it('copies style on Cmd+Shift+C without gating', () => {
    expect(resolveKeybinding(cmd('c', { shiftKey: true }))?.action).toEqual({
      kind: 'copy-style',
    });
    expect(resolveKeybinding(cmd('c', { shiftKey: true, readOnly: true }))?.action).toEqual({
      kind: 'copy-style',
    });
  });

  it('pastes style on Cmd+Shift+V only with write access', () => {
    expect(resolveKeybinding(cmd('v', { shiftKey: true }))?.action).toEqual({
      kind: 'paste-style',
    });
    expect(resolveKeybinding(cmd('v', { shiftKey: true, readOnly: true }))).toBeNull();
  });

  it('keeps plain copy/paste on unshifted chords', () => {
    expect(resolveKeybinding(cmd('c'))?.action).toEqual({ kind: 'copy' });
    expect(resolveKeybinding(cmd('v'))?.action).toEqual({ kind: 'paste' });
  });
});

describe('resolveKeybinding nudge', () => {
  it('nudges one pixel per arrow key', () => {
    expect(resolveKeybinding(plain('arrowup'))).toEqual({
      action: { kind: 'nudge', dx: 0, dy: -1 },
      preventDefault: true,
    });
    expect(resolveKeybinding(plain('arrowright'))?.action).toEqual({
      kind: 'nudge',
      dx: 1,
      dy: 0,
    });
  });

  it('moves ten pixels with shift', () => {
    expect(resolveKeybinding(plain('arrowdown', { shiftKey: true }))?.action).toEqual({
      kind: 'nudge',
      dx: 0,
      dy: 10,
    });
    expect(resolveKeybinding(plain('arrowleft', { shiftKey: true }))?.action).toEqual({
      kind: 'nudge',
      dx: -10,
      dy: 0,
    });
  });

  it('needs a selection and write access, and ignores modifiers', () => {
    expect(resolveKeybinding(plain('arrowup', { hasSelection: false }))).toBeNull();
    expect(resolveKeybinding(plain('arrowup', { readOnly: true }))).toBeNull();
    expect(resolveKeybinding({ ...plain('arrowup'), cmdOrCtrl: true })).toBeNull();
    expect(resolveKeybinding({ ...plain('arrowup'), altKey: true })).toBeNull();
  });
});
