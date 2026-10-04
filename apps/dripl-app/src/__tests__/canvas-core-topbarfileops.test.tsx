import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { useCanvasStore } from '@/lib/store';
import type { DriplElement } from '@dripl/common';

/**
 * The four file operations behind the top bar.
 *
 * These are destructive by design — reset wipes a scene and open replaces one
 * wholesale — so what is pinned is mostly negative space: a declined confirm
 * must keep the canvas, a file the parser could only partly read must not be
 * loaded, and a failed export must still close the menu. The `.dripl` writer
 * and the PNG rasteriser are mocked; the restore pipeline they feed is not,
 * because routing app state through `restoreAppState`/`applyRestoredAppState`
 * instead of a private copy is the hook's actual contract.
 */

const io = vi.hoisted(() => ({
  downloadBlob: vi.fn<(blob: Blob, filename: string) => void>(),
  exportCanvas: vi.fn<(format: string, elements: DriplElement[], options?: unknown) => unknown>(),
  exportToDripl:
    vi.fn<(elements: readonly DriplElement[], appState: Record<string, unknown>) => Blob>(),
  parseDriplDocument: vi.fn<(raw: string) => unknown>(),
}));

vi.mock('@/utils/export', () => ({
  downloadBlob: (...args: [Blob, string]) => io.downloadBlob(...args),
  exportCanvas: (...args: [string, DriplElement[], unknown]) => io.exportCanvas(...args),
  exportToDripl: (...args: [readonly DriplElement[], Record<string, unknown>]) =>
    io.exportToDripl(...args),
  parseDriplDocument: (...args: [string]) => io.parseDriplDocument(...args),
}));

import { useTopBarFileOps } from '@/hooks/useTopBarFileOps';

function element(id: string, extra: Record<string, unknown> = {}): DriplElement {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
    ...extra,
  } as unknown as DriplElement;
}

function seed(elements: DriplElement[] = [], extra: Record<string, unknown> = {}) {
  useCanvasStore.setState({
    elements: [],
    elementsById: new Map(),
    selectedIds: new Set<string>(),
    past: [],
    future: [],
    spatialVersion: 0,
    spatialChangedIds: [],
    spatialChangedIdsVersion: 0,
    zoom: 1,
    panX: 0,
    panY: 0,
    gridEnabled: false,
    gridSize: 20,
    canvasBackground: null,
    theme: 'light',
    fileId: 'file-7',
    fileName: 'untitled',
    pendingEmbed: null,
    draftElement: null,
    ...extra,
  });
  useCanvasStore.getState().setElements(elements, { skipHistory: true });
}

let onActionDone: Mock<() => void>;

function setup() {
  onActionDone = vi.fn<() => void>();
  return { ...renderHook(() => useTopBarFileOps({ onActionDone })) };
}

/** Capture the hidden file input `handleOpenFile` clicks. */
function captureFileInput() {
  const captured: HTMLInputElement[] = [];
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
    this: HTMLInputElement
  ) {
    captured.push(this);
  });
  return captured;
}

async function chooseFile(input: HTMLInputElement, name: string, text: string) {
  const file = new File([text], name, { type: 'application/json' });
  // jsdom's `File` has no `text()`, which is the only read the hook performs.
  Object.defineProperty(file, 'text', { value: async () => text, configurable: true });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  const event = new Event('change');
  Object.defineProperty(event, 'target', { value: input, configurable: true });
  await input.onchange?.(event);
}

let confirmSpy: Mock<(message?: string) => boolean>;
let alertSpy: Mock<(message?: string) => void>;

beforeEach(() => {
  io.downloadBlob.mockReset();
  io.exportCanvas.mockReset();
  io.exportToDripl.mockReset();
  io.parseDriplDocument.mockReset();
  io.exportToDripl.mockReturnValue(new Blob(['{}'], { type: 'application/json' }));
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
  alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
  seed();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reset canvas', () => {
  it('keeps the scene when the confirm is declined', () => {
    seed([element('a')]);
    const { result } = setup();

    act(() => {
      result.current.handleResetCanvas();
    });

    // Declining is the difference between "start over" and "lose the work".
    expect(useCanvasStore.getState().elementsById.has('a')).toBe(true);
    // The menu closes either way, so the user is not left in a dead menu.
    expect(onActionDone).toHaveBeenCalledTimes(1);
  });

  it('empties the scene when the confirm is accepted', () => {
    seed([element('a'), element('b')]);
    const { result } = setup();
    confirmSpy.mockReturnValue(true);

    act(() => {
      result.current.handleResetCanvas();
    });

    expect(useCanvasStore.getState().elements).toHaveLength(0);
    expect(useCanvasStore.getState().elementsById.size).toBe(0);
    expect(onActionDone).toHaveBeenCalledTimes(1);
  });
});

describe('save to file', () => {
  it('writes the live scene plus viewport state, under a filesystem-safe name', () => {
    seed([element('a')], {
      fileName: 'Q3 Board!',
      zoom: 2,
      panX: 30,
      panY: -12,
      gridEnabled: true,
      gridSize: 40,
      canvasBackground: '#101014',
      theme: 'dark',
    });
    const { result } = setup();

    act(() => {
      result.current.handleSaveToFile();
    });

    const [elements, appState] = io.exportToDripl.mock.calls[0]!;
    expect(elements.map(el => el.id)).toEqual(['a']);
    expect(appState).toMatchObject({
      zoom: 2,
      panX: 30,
      panY: -12,
      gridEnabled: true,
      gridSize: 40,
      canvasBackground: '#101014',
      theme: 'dark',
      fileName: 'Q3 Board!',
    });
    // A raw space or `!` in the name would either truncate the download or
    // produce an extension-less file on some platforms.
    expect(io.downloadBlob).toHaveBeenCalledTimes(1);
    expect((io.downloadBlob.mock.calls[0] as unknown as [Blob, string])[1]).toBe('q3-board-.dripl');
    expect(onActionDone).toHaveBeenCalledTimes(1);
  });

  it('falls back to `untitled` for an unnamed canvas', () => {
    seed([element('a')], { fileName: '' });
    const { result } = setup();

    act(() => {
      result.current.handleSaveToFile();
    });

    expect((io.downloadBlob.mock.calls[0] as unknown as [Blob, string])[1]).toBe('untitled.dripl');
  });
});

describe('open file', () => {
  const document_ = {
    elements: [element('imported', { x: 5, y: 6 })],
    appState: {
      zoom: 3,
      panX: 11,
      panY: -22,
      gridEnabled: true,
      gridSize: 32,
      canvasBackground: '#abcdef',
      theme: 'dark',
    },
    partial: false,
    dropped: 0,
  };

  it('replaces the canvas and restores the document app state', async () => {
    seed([element('old')], { selectedIds: new Set(['old']) });
    io.parseDriplDocument.mockReturnValue(document_);
    const inputs = captureFileInput();
    const { result } = setup();

    act(() => {
      result.current.handleOpenFile();
    });
    expect(inputs[0]!.accept).toBe('.dripl,application/json');
    // Opening is a menu action: the menu closes before the file is read.
    expect(onActionDone).toHaveBeenCalledTimes(1);

    await chooseFile(inputs[0]!, 'Roadmap.dripl', JSON.stringify(document_));

    const state = useCanvasStore.getState();
    expect(Array.from(state.elementsById.keys())).toEqual(['imported']);
    // The old selection pointed at an element that no longer exists.
    expect(state.selectedIds.size).toBe(0);
    expect(state.zoom).toBe(3);
    expect(state.panX).toBe(11);
    expect(state.panY).toBe(-22);
    expect(state.gridEnabled).toBe(true);
    expect(state.gridSize).toBe(32);
    expect(state.canvasBackground).toBe('#abcdef');
    expect(state.theme).toBe('dark');
    // The file id is preserved and the extension stripped from the name.
    expect(state.fileId).toBe('file-7');
    expect(state.fileName).toBe('Roadmap');
  });

  it('refuses a document the parser could only partly read', async () => {
    seed([element('old')]);
    io.parseDriplDocument.mockReturnValue({ ...document_, partial: true, dropped: 3 });
    const inputs = captureFileInput();
    const { result } = setup();

    act(() => {
      result.current.handleOpenFile();
    });
    await chooseFile(inputs[0]!, 'partial.dripl', '{}');

    // Loading a salvaged scene as if it were whole would silently delete the
    // elements the parser dropped.
    expect(useCanvasStore.getState().elementsById.has('old')).toBe(true);
    expect(useCanvasStore.getState().zoom).toBe(1);
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it('reports an unreadable file and leaves the canvas alone', async () => {
    seed([element('old')]);
    io.parseDriplDocument.mockImplementation(() => {
      throw new Error('Unexpected token');
    });
    const inputs = captureFileInput();
    const { result } = setup();

    act(() => {
      result.current.handleOpenFile();
    });
    await chooseFile(inputs[0]!, 'broken.dripl', 'not json');

    expect(useCanvasStore.getState().elementsById.has('old')).toBe(true);
    expect(alertSpy).toHaveBeenCalledWith(
      'Could not open this file. Please choose a valid .dripl file.'
    );
  });

  it('does nothing when the picker is dismissed', async () => {
    seed([element('old')]);
    const inputs = captureFileInput();
    const { result } = setup();

    act(() => {
      result.current.handleOpenFile();
    });
    const event = new Event('change');
    Object.defineProperty(event, 'target', { value: inputs[0]!, configurable: true });
    await act(async () => {
      await inputs[0]!.onchange?.(event);
    });

    expect(io.parseDriplDocument).not.toHaveBeenCalled();
    expect(useCanvasStore.getState().elementsById.has('old')).toBe(true);
    expect(alertSpy).not.toHaveBeenCalled();
  });
});

describe('quick png export', () => {
  it('exports on the canvas background and names the file', async () => {
    seed([element('a')], { canvasBackground: '#202024' });
    io.exportCanvas.mockReturnValue(new Blob(['png'], { type: 'image/png' }));
    const { result } = setup();

    await act(async () => {
      await result.current.handleExportImage();
    });

    const [format, elements, options] = io.exportCanvas.mock.calls[0]!;
    expect(format).toBe('png');
    expect((elements as DriplElement[]).map(el => el.id)).toEqual(['a']);
    // Quick export reuses the modal's raster options, so the background here
    // matches the background the modal would produce.
    expect(options).toEqual({ scale: 2, background: '#202024', padding: 16 });
    const filename = (io.downloadBlob.mock.calls[0] as unknown as [Blob, string])[1];
    expect(filename).toMatch(/^canvas-\d+\.png$/);
    expect(onActionDone).toHaveBeenCalledTimes(1);
  });

  it('exports on white when the canvas has no background override', async () => {
    seed([element('a')], { canvasBackground: null });
    io.exportCanvas.mockReturnValue(new Blob(['png'], { type: 'image/png' }));
    const { result } = setup();

    await act(async () => {
      await result.current.handleExportImage();
    });

    // A transparent PNG pasted into a document renders as nothing at all.
    expect(io.exportCanvas.mock.calls[0]![2]).toMatchObject({ background: '#ffffff' });
  });

  it('reports a failed export and still closes the menu', async () => {
    io.exportCanvas.mockImplementation(() => {
      throw new Error('tainted canvas');
    });
    const { result } = setup();

    await act(async () => {
      await result.current.handleExportImage();
    });

    expect(io.downloadBlob).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Failed to export PNG image.');
    // The `finally` is what keeps a thrown export from wedging the menu open.
    expect(onActionDone).toHaveBeenCalledTimes(1);
  });
});
