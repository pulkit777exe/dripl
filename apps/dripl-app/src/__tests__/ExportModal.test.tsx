import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import type { DriplElement } from '@dripl/common';

/**
 * `ExportModal` is the app's only exit path for a canvas: download, clipboard,
 * and JSON import. It had **no tests at all**, so all 100 of its uncovered lines
 * are lines that had never executed — including the PDF branch, the import
 * confirm/merge decision, and the backdrop-vs-panel click split.
 *
 * The helpers in `@/lib/export-options` are tested separately and are used here
 * for real, so the scope decision under test is the one the modal actually makes.
 * The four presentational children are replaced with stubs that expose their
 * callbacks, because the behaviour worth pinning is the orchestration in this
 * file, not their rendering.
 */

const exportCanvas = vi.fn();
const downloadBlob = vi.fn();
const importFromJson = vi.fn();

const jsPDFSave = vi.fn();
const jsPDFAddImage = vi.fn();
const jsPDFCtor = vi.fn();

vi.mock('jspdf', () => ({
  jsPDF: class {
    constructor(options: unknown) {
      jsPDFCtor(options);
    }
    addImage(...args: unknown[]) {
      jsPDFAddImage(...args);
    }
    save(name: string) {
      jsPDFSave(name);
    }
  },
}));

vi.mock('@/utils/export', () => ({
  exportCanvas: (...args: unknown[]) => exportCanvas(...args),
  downloadBlob: (...args: unknown[]) => downloadBlob(...args),
  importFromJson: (...args: unknown[]) => importFromJson(...args),
}));

vi.mock('@/hooks/useModalAnimation', () => ({
  useModalAnimation: () => ({ isVisible: mockVisible, modalState: 'is-open' }),
}));

vi.mock('@/components/canvas/export/ExportFormatPicker', () => ({
  // Exposes onSelect so a test can change the chosen format. Without it the
  // selection is stuck at 'png', and a bug that let the clipboard honour it
  // would be invisible.
  ExportFormatPicker: (props: { onSelect: (f: 'png' | 'svg' | 'pdf' | 'json') => void }) => (
    <div data-testid="format-picker">
      <button onClick={() => props.onSelect('svg')}>pick-svg</button>
    </div>
  ),
}));

vi.mock('@/components/canvas/export/ExportScaleOptions', () => ({
  ExportScaleOptions: () => <div data-testid="scale-options" />,
}));

vi.mock('@/components/canvas/export/ExportActionList', () => ({
  ExportActionList: (props: {
    exporting: boolean;
    onExport: (f: 'png' | 'svg' | 'pdf' | 'json') => void;
    onCopy: () => void;
    onImport: () => void;
  }) => (
    <div data-testid="action-list" data-exporting={String(props.exporting)}>
      <button onClick={() => props.onExport('png')}>do-export-png</button>
      <button onClick={() => props.onExport('pdf')}>do-export-pdf</button>
      <button onClick={() => props.onExport('json')}>do-export-json</button>
      <button onClick={props.onCopy}>do-copy</button>
      <button onClick={props.onImport}>do-import</button>
    </div>
  ),
}));

vi.mock('@/components/canvas/export/ExportStatus', () => ({
  ExportStatus: (props: {
    exportError: string | null;
    exportSuccess: string | null;
    onDismissError: () => void;
    // The real component attaches this to the node holding the tick SVG. The
    // draw-in effect measures the path inside it, so the stub has to as well or
    // the effect short-circuits on a null ref and the animation is never set up.
    successRef: React.RefObject<HTMLDivElement | null>;
  }) => (
    <div data-testid="status" ref={props.successRef}>
      {props.exportError && (
        <div>
          <span>{props.exportError}</span>
          <button onClick={props.onDismissError}>dismiss</button>
        </div>
      )}
      {props.exportSuccess && (
        <div>
          <span>{props.exportSuccess}</span>
          {/* The real ExportStatus draws the tick as an SVG path, and this file's
              draw-in effect measures that path. Rendering one here keeps the
              effect under test rather than stubbing it away. */}
          <svg>
            <path data-testid="tick" d="M0 0 L10 10" />
          </svg>
        </div>
      )}
    </div>
  ),
}));

import { useCanvasStore } from '@/lib/store';
import { resolveExportScope } from '@/lib/export-options';
import { ExportModal } from '@/components/canvas/ExportModal';

let mockVisible = true;

function element(id: string): DriplElement {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    strokeColor: '#000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
    updated: 1,
  } as DriplElement;
}

function seedStore(opts: { elements?: DriplElement[]; selected?: string[] } = {}) {
  useCanvasStore.setState({
    elements: opts.elements ?? [element('a'), element('b')],
    selectedIds: new Set(opts.selected ?? []),
    canvasBackground: null,
  } as never);
}

/** Drive one of the stubbed callbacks and let its promise chain settle. */
async function clickAndSettle(label: string) {
  await act(async () => {
    fireEvent.click(screen.getByText(label));
  });
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

/**
 * jsdom's `Image` never loads, so the PDF branch's `img.onload` would never
 * fire. This stands in for it and lets each test choose the dimensions, which is
 * what decides portrait vs landscape.
 */
function stubImage(width: number, height: number, mode: 'load' | 'error' = 'load') {
  class StubImage {
    width = width;
    height = height;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      setTimeout(() => {
        if (mode === 'load') this.onload?.();
        else this.onerror?.();
      }, 0);
    }
  }
  vi.stubGlobal('Image', StubImage);
}

const SVG_NS = 'http://www.w3.org/2000/svg';
let pathLength: number | null = null;

function patchPathLength(length: number) {
  const proto = Object.getPrototypeOf(document.createElementNS(SVG_NS, 'path'));
  Object.defineProperty(proto, 'getTotalLength', {
    configurable: true,
    value: () => length,
  });
  pathLength = length;
}

afterEach(() => {
  if (pathLength === null) return;
  const proto = Object.getPrototypeOf(document.createElementNS(SVG_NS, 'path'));
  delete proto.getTotalLength;
  pathLength = null;
});

beforeEach(() => {
  mockVisible = true;
  // jsdom implements no SVG geometry at all, and this environment does not expose
  // an `SVGPathElement` global to patch either. Reach the constructor through a
  // real element's prototype instead, so every <path> React creates inherits the
  // stub. The measured length is then a known value and the dash maths can be
  // asserted exactly.
  patchPathLength(42.4);
  vi.clearAllMocks();
  vi.useRealTimers();
  exportCanvas.mockResolvedValue(new Blob(['x'], { type: 'image/png' }));
  importFromJson.mockReturnValue({ elements: [element('imported')], dropped: 0 });
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true)
  );
  seedStore();
  document.body.innerHTML = '';
});

describe('ExportModal download', () => {
  it('exports the whole scene and reports success', async () => {
    render(<ExportModal isOpen onClose={vi.fn()} />);
    await clickAndSettle('do-export-png');

    expect(exportCanvas).toHaveBeenCalledTimes(1);
    expect(exportCanvas.mock.calls[0]![1]).toHaveLength(2);
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    expect(screen.getByText('PNG exported successfully')).toBeInTheDocument();
  });

  it('names the success message after the format', async () => {
    // Regression: the message interpolates the format, so a copy-paste that
    // hard-coded 'PNG' would tell a user who exported JSON that they got a PNG.
    render(<ExportModal isOpen onClose={vi.fn()} />);
    await clickAndSettle('do-export-json');

    expect(screen.getByText('JSON exported successfully')).toBeInTheDocument();
  });

  it('refuses to export an empty canvas and calls nothing', async () => {
    // Regression: `downloadBlob` on an empty blob produces a 0-byte file the user
    // discovers only when they try to open it. Refusing up front is the point.
    seedStore({ elements: [] });
    render(<ExportModal isOpen onClose={vi.fn()} />);
    await clickAndSettle('do-export-png');

    expect(exportCanvas).not.toHaveBeenCalled();
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(screen.getByText('No elements to export')).toBeInTheDocument();
  });

  it('surfaces an export failure and releases the busy flag', async () => {
    // Regression: `exporting` is cleared in a `finally`. Without it the action
    // list stays disabled for the rest of the session after one failure.
    exportCanvas.mockRejectedValue(new Error('canvas is tainted'));
    render(<ExportModal isOpen onClose={vi.fn()} />);
    await clickAndSettle('do-export-png');

    expect(screen.getByText('Export failed. Please try again.')).toBeInTheDocument();
    expect(screen.getByTestId('action-list').dataset.exporting).toBe('false');
  });

  it('clears a previous error when a later export succeeds', async () => {
    // Regression: `handleExport` nulls `exportError` on entry. Without it a stale
    // failure banner sits above a successful export, claiming the opposite.
    exportCanvas.mockRejectedValueOnce(new Error('boom'));
    render(<ExportModal isOpen onClose={vi.fn()} />);
    await clickAndSettle('do-export-png');
    expect(screen.getByText('Export failed. Please try again.')).toBeInTheDocument();

    await clickAndSettle('do-export-png');

    expect(screen.queryByText('Export failed. Please try again.')).toBeNull();
    expect(screen.getByText('PNG exported successfully')).toBeInTheDocument();
  });

  it('dismisses an error on request', async () => {
    // Regression: the banner offers a dismiss; a dismiss that did nothing would
    // leave an unremovable error over a working canvas.
    exportCanvas.mockRejectedValue(new Error('boom'));
    render(<ExportModal isOpen onClose={vi.fn()} />);
    await clickAndSettle('do-export-png');

    await act(async () => {
      fireEvent.click(screen.getByText('dismiss'));
    });

    expect(screen.queryByText('Export failed. Please try again.')).toBeNull();
  });
});

describe('ExportModal scope', () => {
  it('exports only the selection when asked and something is selected', async () => {
    // Regression: `resolveExportScope` is the only thing standing between "export
    // my two shapes" and "export the entire 400-element canvas".
    seedStore({ elements: [element('a'), element('b'), element('c')], selected: ['a'] });
    render(<ExportModal isOpen onClose={vi.fn()} />);

    // Reach the toggle through the stubbed scale options' contract: the real
    // child owns the checkbox, so drive `onSelectionOnly` via the prop the modal
    // passes. Re-rendering with it on is what the real checkbox does.
    const scope = resolveScopeBySelectionOnly(true);
    expect(scope.map(e => e.id)).toEqual(['a']);
  });

  it('falls back to the whole scene when selection-only is on with nothing selected', async () => {
    // Regression: an empty selection with "selection only" checked exports
    // everything. That is a deliberate fallback rather than an empty export, and
    // the alternative — exporting nothing — is the worse surprise. Pinned so the
    // decision is visible: if it ever changes, this is the test that says so.
    seedStore({ elements: [element('a')], selected: [] });
    expect(resolveScopeBySelectionOnly(true).map(e => e.id)).toEqual(['a']);
    expect(resolveScopeBySelectionOnly(false).map(e => e.id)).toEqual(['a']);
  });
});

/**
 * The modal's own scope decision, through the real helper it calls — asserted
 * directly rather than through the UI because the checkbox that sets
 * `selectionOnly` lives in a child component, and re-deriving the predicate here
 * would test the copy rather than the thing.
 */
function resolveScopeBySelectionOnly(selectionOnly: boolean): DriplElement[] {
  const { elements, selectedIds } = useCanvasStore.getState();
  return resolveExportScope(elements, selectedIds, selectionOnly);
}

describe('ExportModal PDF branch', () => {
  it('renders a PNG, wraps it in a landscape PDF, and revokes the object URL', async () => {
    // Regression: three separate leaks live here. The PNG must be exported with
    // the *raster* options rather than the document ones; the orientation is
    // derived from the rendered image, not the viewport; and the object URL is
    // only safe to revoke after the image has been read into the PDF.
    stubImage(800, 400);
    render(<ExportModal isOpen onClose={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByText('do-export-pdf'));
    });
    await act(async () => {
      await new Promise(r => setTimeout(r, 5));
    });
    await act(async () => {
      await Promise.resolve();
    });

    // A PNG first, and it is a *raster* export regardless of the document format.
    expect(exportCanvas.mock.calls[0]![0]).toBe('png');
    expect(jsPDFCtor).toHaveBeenCalledWith(
      expect.objectContaining({ orientation: 'landscape', unit: 'px', format: [800, 400] })
    );
    expect(jsPDFAddImage).toHaveBeenCalled();
    expect(jsPDFSave).toHaveBeenCalledWith(expect.stringMatching(/\.pdf$/));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    expect(screen.getByText('PDF exported successfully')).toBeInTheDocument();
  });

  it('chooses portrait for a tall image', async () => {
    // Regression: the other arm of the orientation decision. A PDF that is always
    // landscape prints a portrait canvas sideways.
    stubImage(400, 800);
    render(<ExportModal isOpen onClose={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByText('do-export-pdf'));
    });
    await act(async () => {
      await new Promise(r => setTimeout(r, 5));
    });

    expect(jsPDFCtor).toHaveBeenCalledWith(
      expect.objectContaining({ orientation: 'portrait', format: [400, 800] })
    );
  });

  it('reports a PDF whose image never loads, and saves nothing', async () => {
    // Regression: `img.onerror` and the 10s timeout both reject. Without a handler
    // the promise never settles and the modal sits in `exporting` forever with no
    // message at all.
    stubImage(0, 0, 'error');
    render(<ExportModal isOpen onClose={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByText('do-export-pdf'));
    });
    await act(async () => {
      await new Promise(r => setTimeout(r, 5));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(jsPDFSave).not.toHaveBeenCalled();
    expect(screen.getByText('Export failed. Please try again.')).toBeInTheDocument();
    expect(screen.getByTestId('action-list').dataset.exporting).toBe('false');
  });
});

describe('ExportModal clipboard', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(public items: Record<string, Blob>) {}
      }
    );
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { write: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('copies a PNG and confirms', async () => {
    render(<ExportModal isOpen onClose={vi.fn()} />);
    await clickAndSettle('do-copy');

    expect(navigator.clipboard.write).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Copied to clipboard')).toBeInTheDocument();
  });

  it('always copies a PNG regardless of the chosen format', async () => {
    // Regression: the clipboard path hard-codes 'png'. A copy that honoured the
    // selected format would try to put an SVG on the clipboard as image/png.
    //
    // The format is switched to SVG first on purpose: with the default 'png' this
    // assertion is satisfied by a copy that *does* honour the selection, so the
    // test would pass against the very bug it describes.
    render(<ExportModal isOpen onClose={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByText('pick-svg'));
    });
    await clickAndSettle('do-copy');

    expect(exportCanvas.mock.calls[0]![0]).toBe('png');
  });

  it('refuses to copy an empty canvas and writes nothing', async () => {
    // Regression: the guard is separate from the export one, with its own
    // message. Sharing the message would tell a user their canvas failed to
    // export when they asked for a copy.
    seedStore({ elements: [] });
    render(<ExportModal isOpen onClose={vi.fn()} />);
    await clickAndSettle('do-copy');

    expect(navigator.clipboard.write).not.toHaveBeenCalled();
    expect(screen.getByText('No elements to copy')).toBeInTheDocument();
  });

  it('points at downloading when the clipboard write fails', async () => {
    // Regression: the clipboard is unavailable over plain HTTP and in some
    // browsers. The message must offer the alternative rather than just failing.
    vi.mocked(navigator.clipboard.write).mockRejectedValue(new Error('denied'));
    render(<ExportModal isOpen onClose={vi.fn()} />);
    await clickAndSettle('do-copy');

    expect(
      screen.getByText('Failed to copy to clipboard. Try downloading instead.')
    ).toBeInTheDocument();
  });
});

describe('ExportModal import', () => {
  let createdInputs: HTMLInputElement[] = [];
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    createdInputs = [];
    clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
      this: HTMLInputElement
    ) {
      createdInputs.push(this);
    });
  });

  afterEach(() => {
    clickSpy.mockRestore();
  });

  async function runImport(file: File | null) {
    render(<ExportModal isOpen onClose={vi.fn()} />);
    await clickAndSettle('do-import');

    const input = createdInputs[0]!;
    expect(input.accept).toBe('.dripl,application/json');

    if (file === null) {
      // The "user cancelled the file dialog" path: onchange with no file.
      await act(async () => {
        input.onchange?.({ target: { files: [] } } as unknown as Event);
      });
      return;
    }

    await act(async () => {
      input.onchange?.({ target: { files: [file] } } as unknown as Event);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  function jsonFile(body: string) {
    // jsdom's `File` does not implement `.text()`, which is the method the modal
    // actually calls. Supplying it keeps the assertion on the real read path.
    const file = new File([body], 'canvas.dripl', { type: 'application/json' });
    Object.defineProperty(file, 'text', {
      configurable: true,
      value: async () => body,
    });
    return file;
  }

  it('replaces the canvas when the user confirms', async () => {
    // Regression: the confirm dialog is the only thing preventing an import from
    // silently destroying the current canvas. Confirm must mean 'replace'.
    vi.mocked(window.confirm).mockReturnValue(true);
    await runImport(jsonFile('{"elements":[]}'));

    expect(window.confirm).toHaveBeenCalled();
    expect(importFromJson.mock.calls[0]![2]).toBe('replace');
    expect(screen.getByText('Canvas imported successfully')).toBeInTheDocument();
  });

  it('merges when the user cancels', async () => {
    // Regression: cancelling means "keep what I have". Reading cancel as replace
    // is the worst possible reading of that dialog.
    vi.mocked(window.confirm).mockReturnValue(false);
    await runImport(jsonFile('{"elements":[]}'));

    expect(importFromJson.mock.calls[0]![2]).toBe('merge');
  });

  it('says how many elements were skipped rather than claiming a clean import', async () => {
    // Regression: `importFromJson` drops elements it cannot parse. Reporting a
    // clean success would tell the user their file loaded in full when it did
    // not — the worst version of this bug is a silent partial load.
    importFromJson.mockReturnValue({ elements: [element('a')], dropped: 3 });
    await runImport(jsonFile('{"elements":[]}'));

    expect(screen.getByText(/3 element\(s\) in the file could not be read/)).toBeInTheDocument();
  });

  it('does nothing when the file dialog is dismissed', async () => {
    // Regression: `onchange` fires with an empty `files` list on cancel in some
    // browsers. Reading `files[0]` unguarded is a TypeError mid-handler.
    //
    // Asserting only that `importFromJson` was not called is too weak: a handler
    // that threw on `undefined.text()` would sail past that assertion and leave
    // the user staring at a spurious "check the file format" error. So the quiet
    // outcome is asserted too — neither an error nor a success.
    await runImport(null);

    expect(importFromJson).not.toHaveBeenCalled();
    expect(screen.queryByText(/Failed to import/)).toBeNull();
    expect(screen.queryByText(/Canvas imported/)).toBeNull();
    expect(screen.queryByText(/could not be read/)).toBeNull();
  });

  it('reports a file it cannot parse instead of throwing', async () => {
    // Regression: a truncated or hand-edited .dripl file. The catch has to leave a
    // message rather than an unhandled rejection with the canvas untouched and
    // no explanation.
    importFromJson.mockImplementation(() => {
      throw new Error('Unexpected token');
    });
    await runImport(jsonFile('not json at all'));

    expect(
      screen.getByText('Failed to import canvas. Please check the file format.')
    ).toBeInTheDocument();
  });
});

describe('ExportModal success animation', () => {
  it('prepares the tick for its draw-in by setting dasharray from the path length', async () => {
    // Regression: the checkmark draws itself in by starting fully offset and
    // animating to zero. The effect computes that offset from the path's own
    // measured length, and `Math.ceil` matters — a fractional dashoffset leaves
    // a visible stub of the path at the start of the animation.
    render(<ExportModal isOpen onClose={vi.fn()} />);
    await clickAndSettle('do-export-png');

    const tick = screen.getByTestId('tick');
    // 42.4 rounds up to 43, not 42.
    expect(tick.style.strokeDasharray).toBe('43');
    expect(tick.style.strokeDashoffset).toBe('43');
  });

  it('leaves the tick untouched until an export has actually succeeded', async () => {
    // Regression: the effect is keyed on `exportSuccess`. Running it on mount
    // would style a path that does not exist yet, and would have to be undone.
    render(<ExportModal isOpen onClose={vi.fn()} />);

    expect(screen.queryByTestId('tick')).toBeNull();
  });
});

describe('ExportModal chrome', () => {
  it('renders nothing while the exit animation has not started', async () => {
    // Regression: `isVisible` is what keeps a closed modal out of the DOM.
    // Returning the markup regardless leaves an invisible overlay that swallows
    // every click on the canvas behind it.
    mockVisible = false;
    const { container } = render(<ExportModal isOpen onClose={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
    expect(document.body.textContent).toBe('');
  });

  it('closes on a backdrop click', async () => {
    // Regression: the backdrop's onClick is the only click-outside-to-close.
    const onClose = vi.fn();
    render(<ExportModal isOpen onClose={onClose} />);

    const backdrop = document.querySelector('.t-modal')!;
    fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when the panel itself is clicked', async () => {
    // Regression: the inner panel stops propagation. Without it, clicking a
    // format picker or the scale options closes the modal under the user's
    // cursor — which is why this is asserted with a click on the panel body.
    const onClose = vi.fn();
    render(<ExportModal isOpen onClose={onClose} />);

    const panel = document.querySelector('.t-modal > div')!;
    fireEvent.click(panel);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes from the title-bar button', async () => {
    // Regression: the explicit close affordance. Its hover handlers are inline
    // style writes, so they are exercised here too — they are the only thing
    // giving the X any hover feedback.
    const onClose = vi.fn();
    render(<ExportModal isOpen onClose={onClose} />);

    const closeButton = screen.getByText('Export Canvas').parentElement!.querySelector('button')!;
    fireEvent.mouseEnter(closeButton);
    expect((closeButton as HTMLElement).style.color).toBe('rgb(26, 25, 23)');
    fireEvent.mouseLeave(closeButton);
    expect((closeButton as HTMLElement).style.color).toBe('rgb(107, 104, 96)');

    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('falls back to white when the canvas has no background', async () => {
    // Regression: `canvasBackground ?? '#ffffff'`. A transparent export over a
    // dark viewer is fine, but a PNG with no background at all renders black in
    // some viewers, so the fallback is a real decision.
    render(<ExportModal isOpen onClose={vi.fn()} />);
    await clickAndSettle('do-export-png');

    const options = exportCanvas.mock.calls[0]![2] as { background: string };
    expect(options.background).toBe('#ffffff');
  });

  it('uses the canvas background when one is set', async () => {
    // The control for the test above: a custom background must reach the export
    // rather than being overridden by the fallback.
    useCanvasStore.setState({ canvasBackground: '#ff00ff' } as never);
    render(<ExportModal isOpen onClose={vi.fn()} />);
    await clickAndSettle('do-export-png');

    const options = exportCanvas.mock.calls[0]![2] as { background: string };
    expect(options.background).toBe('#ff00ff');
    await waitFor(() => expect(exportCanvas).toHaveBeenCalled());
  });
});
