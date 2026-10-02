import type { ActiveTool } from '@/lib/store';

/**
 * Keybinding resolver — pure dispatch extracted from `useCanvasKeyboard`.
 *
 * The hook owns focus guards, the Space pan override, and store execution;
 * everything else is a precedence-ordered map from (modifiers, key) to a
 * first-match action. Single home for the shortcut table, unit-tested
 * without keyboards or stores.
 *
 * One fixed bug vs the inline chain: Cmd/Ctrl+Shift+F previously fell into
 * the plain Cmd+F (find) branch because it was checked first, so "fit to
 * screen" was unreachable by keyboard. The resolver checks the shifted
 * variant first.
 */

export const LETTER_TOOLS: Record<string, ActiveTool> = {
  v: 'select',
  r: 'rectangle',
  d: 'diamond',
  e: 'ellipse',
  o: 'ellipse',
  p: 'freedraw',
  l: 'line',
  a: 'arrow',
  t: 'text',
  f: 'frame',
  x: 'eraser',
  h: 'hand',
};

export const NUMERIC_TOOLS: Record<string, ActiveTool> = {
  '1': 'select',
  '2': 'rectangle',
  '3': 'diamond',
  '4': 'ellipse',
  '5': 'arrow',
  '6': 'line',
  '7': 'freedraw',
  '8': 'text',
  '9': 'image',
  '0': 'eraser',
};

export type KeybindingAction =
  | { kind: 'tool'; tool: ActiveTool }
  | { kind: 'zoom-in' }
  | { kind: 'zoom-out' }
  | { kind: 'reset-view' }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'select-all' }
  | { kind: 'find' }
  | { kind: 'copy' }
  | { kind: 'paste' }
  | { kind: 'duplicate' }
  | { kind: 'toggle-grid' }
  | { kind: 'group' }
  | { kind: 'ungroup' }
  | { kind: 'fit' }
  | { kind: 'send-backward' }
  | { kind: 'send-to-back' }
  | { kind: 'bring-forward' }
  | { kind: 'bring-to-front' }
  | { kind: 'delete-selection' }
  | { kind: 'escape' }
  | { kind: 'nudge'; dx: number; dy: number }
  | { kind: 'copy-style' }
  | { kind: 'paste-style' };

export interface KeybindingInput {
  /** Lowercased `e.key`. Brackets match only unshifted (shift yields `{`/`}`). */
  key: string;
  cmdOrCtrl: boolean;
  altKey: boolean;
  shiftKey: boolean;
  readOnly: boolean;
  hasSelection: boolean;
}

export interface ResolvedKeybinding {
  action: KeybindingAction;
  /** Whether the hook must `preventDefault` (mirrors the inline chain). */
  preventDefault: boolean;
}

/** First-match resolution in the historical precedence order. */
export function resolveKeybinding(input: KeybindingInput): ResolvedKeybinding | null {
  const { key, cmdOrCtrl, altKey, shiftKey, readOnly, hasSelection } = input;
  const plain = !cmdOrCtrl && !altKey && !shiftKey;

  if (plain) {
    const tool = LETTER_TOOLS[key];
    if (tool) return { action: { kind: 'tool', tool }, preventDefault: false };
    const numericTool = NUMERIC_TOOLS[key];
    if (numericTool) return { action: { kind: 'tool', tool: numericTool }, preventDefault: true };
  }

  if (!cmdOrCtrl && !altKey && (key === '+' || key === '=')) {
    return { action: { kind: 'zoom-in' }, preventDefault: true };
  }
  if (!cmdOrCtrl && !altKey && (key === '-' || key === '_')) {
    return { action: { kind: 'zoom-out' }, preventDefault: true };
  }

  if (cmdOrCtrl && key === 'z') {
    if (readOnly) return null;
    return { action: shiftKey ? { kind: 'redo' } : { kind: 'undo' }, preventDefault: true };
  }
  if (cmdOrCtrl && key === 'y') {
    if (readOnly) return null;
    return { action: { kind: 'redo' }, preventDefault: true };
  }
  if (cmdOrCtrl && key === 'a') {
    return { action: { kind: 'select-all' }, preventDefault: true };
  }
  // Shifted variant first: the inline chain checked plain Cmd+F first,
  // making fit-to-screen unreachable.
  if (cmdOrCtrl && shiftKey && key === 'f') {
    return { action: { kind: 'fit' }, preventDefault: true };
  }
  if (cmdOrCtrl && key === 'f') {
    return { action: { kind: 'find' }, preventDefault: true };
  }
  // Shifted clipboard variants precede plain copy/paste (same shadowing
  // reason as Cmd+Shift+F above).
  if (cmdOrCtrl && shiftKey && key === 'c') {
    return { action: { kind: 'copy-style' }, preventDefault: true };
  }
  if (cmdOrCtrl && shiftKey && key === 'v') {
    if (readOnly) return null;
    return { action: { kind: 'paste-style' }, preventDefault: true };
  }
  if (cmdOrCtrl && key === 'c') {
    return { action: { kind: 'copy' }, preventDefault: true };
  }
  if (cmdOrCtrl && key === 'v') {
    if (readOnly) return null;
    return { action: { kind: 'paste' }, preventDefault: true };
  }
  if (cmdOrCtrl && key === 'd') {
    if (readOnly) return null;
    return { action: { kind: 'duplicate' }, preventDefault: true };
  }
  if (cmdOrCtrl && altKey && key === 'g') {
    return { action: { kind: 'toggle-grid' }, preventDefault: true };
  }
  if (cmdOrCtrl && key === 'g') {
    if (readOnly) return null;
    return { action: shiftKey ? { kind: 'ungroup' } : { kind: 'group' }, preventDefault: true };
  }
  if (cmdOrCtrl && key === '0') {
    return { action: { kind: 'fit' }, preventDefault: true };
  }
  if (cmdOrCtrl && shiftKey && key === 'h') {
    return { action: { kind: 'reset-view' }, preventDefault: true };
  }

  if (key === '[') {
    if (readOnly) return null;
    return {
      action: cmdOrCtrl ? { kind: 'send-to-back' } : { kind: 'send-backward' },
      preventDefault: true,
    };
  }
  if (key === ']') {
    if (readOnly) return null;
    return {
      action: cmdOrCtrl ? { kind: 'bring-to-front' } : { kind: 'bring-forward' },
      preventDefault: true,
    };
  }

  // `key` is lowercased upstream (`e.key.toLowerCase()`), so Delete,
  // Backspace, and Escape match here in lowercase form.
  if (key === 'delete' || key === 'backspace') {
    if (readOnly || !hasSelection) return null;
    return { action: { kind: 'delete-selection' }, preventDefault: true };
  }

  if (key === 'escape') {
    return { action: { kind: 'escape' }, preventDefault: false };
  }

  // Arrow-key nudge (Shift ×10). Plain arrows only — modifiers are reserved.
  // Gated like delete: needs a selection and write access.
  if (!cmdOrCtrl && !altKey) {
    const step = shiftKey ? 10 : 1;
    if (key === 'arrowup' || key === 'arrowdown' || key === 'arrowleft' || key === 'arrowright') {
      if (readOnly || !hasSelection) return null;
      const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
      const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
      return { action: { kind: 'nudge', dx, dy }, preventDefault: true };
    }
  }

  return null;
}
