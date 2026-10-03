import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HelpModal from '@/components/canvas/HelpModal';
import { resolveKeybinding } from '@/lib/canvas/keybindings';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function openHelp() {
  const onClose = vi.fn();
  const utils = render(<HelpModal isOpen onClose={onClose} />);
  act(() => {
    vi.advanceTimersToNextFrame();
  });
  return { ...utils, onClose };
}

/**
 * Resolve a shortcut as written in the help modal. The key may itself be `+`
 * or `-`, so the trailing key is taken as the text after the last modifier
 * separator rather than by splitting on every `+`.
 */
function resolveHelpShortcut(shortcut: string) {
  const lower = shortcut.toLowerCase();
  const cmdOrCtrl = /\bctrl\b/.test(lower);
  const shiftKey = /\bshift\b/.test(lower);
  const altKey = /\balt\b/.test(lower);

  let key = lower.trim();
  key = key.replace(/\b(ctrl|shift|cmd|meta|alt)\s*\+?\s*/g, '').trim();
  // "Ctrl + +" leaves a trailing '+' as the key itself.
  if (key === '+' || key === '-' || key === '=' || key === '_') {
    key = shortcut.trim().slice(-1);
  }
  const resolved = resolveKeybinding({
    key,
    cmdOrCtrl,
    altKey,
    shiftKey,
    readOnly: false,
    hasSelection: true,
  });
  return resolved?.action.kind ?? null;
}

describe('HelpModal', () => {
  it('renders nothing while closed', () => {
    const { container } = render(<HelpModal isOpen={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Help', { selector: 'h2' })).not.toBeInTheDocument();
  });

  it('opens on the next animation frame', () => {
    openHelp();
    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();
    expect(document.querySelector('.t-modal')?.className).toContain('is-open');
  });

  it('lists both shortcut groups', () => {
    openHelp();
    expect(screen.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tools' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Editor' })).toBeInTheDocument();
  });

  it('pairs every tool with a shortcut', () => {
    openHelp();
    for (const [tool, shortcut] of [
      ['Hand (panning tool)', 'H'],
      ['Selection', 'V or 1'],
      ['Rectangle', 'R or 2'],
      ['Eraser', 'X or 0'],
      ['Frame', 'F'],
    ] as const) {
      expect(screen.getByText(tool)).toBeInTheDocument();
      expect(screen.getByText(shortcut)).toBeInTheDocument();
    }
  });

  it('asks to close on a backdrop click and unmounts after the close animation', () => {
    const onClose = vi.fn();
    const { rerender } = render(<HelpModal isOpen onClose={onClose} />);
    act(() => {
      vi.advanceTimersToNextFrame();
    });

    fireEvent.click(document.querySelector('.t-modal') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);

    // The parent flips `isOpen`, which drives the close animation; the modal
    // stays mounted until it finishes.
    act(() => {
      rerender(<HelpModal isOpen={false} onClose={onClose} />);
    });
    expect(document.querySelector('.t-modal')?.className).toContain('is-closing');

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByRole('heading', { name: 'Help' })).not.toBeInTheDocument();
  });

  it('does not close when the dialog body is clicked', () => {
    const { onClose } = openHelp();
    fireEvent.click(screen.getByRole('heading', { name: 'Keyboard shortcuts' }));
    expect(onClose).not.toHaveBeenCalled();
  });
});

/**
 * The help modal is the user-facing documentation for the shortcut table, so a
 * drift between the two is a real defect: the user presses what the modal
 * promises and nothing happens.
 *
 * Four rows are known to be wrong today. They are pinned here rather than
 * fixed, because each has two defensible resolutions (change the binding, or
 * change the documentation) and that is a product call:
 *
 *   "Cut — Ctrl+X"          → no cut binding exists at all (resolve: null)
 *   "Zoom in — Ctrl + +"    → zoom is the bare '+', not Ctrl+'+'
 *   "Zoom out — Ctrl + -"   → zoom is the bare '-', not Ctrl+'-'
 *   "Reset zoom — Ctrl+0"   → Ctrl+0 is fit-to-screen; reset is Ctrl+Shift+H
 *
 * Every other documented shortcut is verified below against the resolver.
 */
describe('HelpModal shortcut accuracy', () => {
  it('documents shortcuts the resolver actually binds', () => {
    openHelp();
    const accurate: Array<[string, string]> = [
      ['Delete', 'delete-selection'],
      ['Copy', 'copy'],
      ['Paste', 'paste'],
      ['Copy style', 'copy-style'],
      ['Paste style', 'paste-style'],
      ['Select all', 'select-all'],
      ['Undo', 'undo'],
      ['Redo', 'redo'],
      ['Fit to screen', 'fit'],
      ['Toggle grid', 'toggle-grid'],
    ];

    for (const [label, expectedKind] of accurate) {
      // Resolve from the shortcut text rendered next to the label.
      const shortcut = readShortcut(label);
      expect(resolveHelpShortcut(shortcut)).toBe(expectedKind);
    }
  });

  it('lists the four known-inaccurate shortcuts', () => {
    openHelp();
    // Pinned so the drift stays visible and is re-checked whenever the
    // binding table changes.
    expect(readShortcut('Cut')).toBe('Ctrl+X');
    expect(resolveHelpShortcut(readShortcut('Cut'))).toBeNull();

    // Documented as Ctrl + +, but the binding is the bare key.
    expect(readShortcut('Zoom in')).toBe('Ctrl + +');
    expect(resolveHelpShortcut(readShortcut('Zoom in'))).toBeNull();
    expect(resolveHelpShortcut('+')).toBe('zoom-in');

    expect(readShortcut('Zoom out')).toBe('Ctrl + -');
    expect(resolveHelpShortcut(readShortcut('Zoom out'))).toBeNull();
    expect(resolveHelpShortcut('-')).toBe('zoom-out');

    // Documented as Ctrl+0, but Ctrl+0 is fit-to-screen; reset is Ctrl+Shift+H.
    expect(readShortcut('Reset zoom')).toBe('Ctrl+0');
    expect(resolveHelpShortcut(readShortcut('Reset zoom'))).toBe('fit');
    expect(resolveHelpShortcut('Ctrl+Shift+H')).toBe('reset-view');
  });
});

/**
 * Each shortcut row is a flex div holding the tool name and a monospace
 * shortcut chip. Several labels double as shortcut text ("Delete — Delete"),
 * so rows are matched on their first child's exact text.
 */
function readShortcut(label: string): string {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('div.justify-between'));
  const row = rows.find(r => r.firstElementChild?.textContent === label);
  if (!row) throw new Error(`no shortcut row labelled ${label}`);
  return row.lastElementChild!.textContent!.trim();
}
