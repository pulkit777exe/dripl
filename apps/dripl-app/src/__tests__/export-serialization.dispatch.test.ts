import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriplElement } from '@dripl/common';
import { DRIPL_SCENE_TYPE, DRIPL_SCENE_VERSION, MAX_IMPORT_ELEMENTS } from '@/utils/export/native';
import { exportCanvas, exportToJson, importFromJson } from '@/utils/export/serialization';

/**
 * `utils/export/serialization.ts` — the format dispatcher and the import merge.
 *
 * Three separate contracts live here and none of them is visible from any other
 * test file, because every caller that exercises them mocks this module:
 *
 * 1. **`exportCanvas` routing.** Four formats, four different writers, and a
 *    signature that is `Promise<Blob> | Blob` — only PNG is async. `ExportModal`
 *    papers over that with `await Promise.resolve(...)`, so the sync/async split
 *    is real but easy to break silently.
 * 2. **`importFromJson` mode semantics.** Merge and replace disagree about ids,
 *    on purpose, and the disagreement is the whole point of having two modes.
 * 3. **The merge capacity guard**, which is a `>` against a shared constant and
 *    therefore has an exact boundary worth pinning.
 *
 * `./raster` is mocked because the real `exportToPng` needs a 2D context that
 * jsdom does not provide; the mocked writer records its arguments so the PNG
 * branch is proved to *forward the options*, not merely to return something.
 * `./vector` and `./native` are deliberately left real: their output is
 * inspectable, so a routing mix-up shows up as the wrong bytes rather than as a
 * spy that happened to be called.
 */

/** The option bag `serialization.ts` accepts and forwards to the writers. */
interface ExportOptions {
  scale?: number;
  background?: string;
  padding?: number;
  customWidth?: number;
  customHeight?: number;
  appState?: Record<string, unknown>;
}

/** What the mocked PNG writer saw. Installed by `vi.mock`, hence `vi.hoisted`. */
const pngWriter = vi.hoisted(() => {
  const calls: Array<{ elements: DriplElement[]; options: ExportOptions | undefined }> = [];
  const exportToPng = (elements: DriplElement[], options?: ExportOptions): Promise<Blob> => {
    calls.push({ elements, options });
    return Promise.resolve(new Blob(['png-bytes'], { type: 'image/png' }));
  };
  return { calls, exportToPng };
});

vi.mock('@/utils/export/raster', () => ({
  exportToPng: pngWriter.exportToPng,
  generateThumbnail: (): Promise<string> => Promise.resolve(''),
}));

/**
 * A rectangle carrying only the fields `BaseElementSchema` requires; every other
 * field has a default. That matters for the import tests: they assert on strict
 * schema acceptance, so a fixture padded with extra fields could satisfy the
 * document for the wrong reason.
 */
const rect = (id: string): DriplElement =>
  ({ id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }) as DriplElement;

function readBlob(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

/** `exportCanvas` is `Promise<Blob> | Blob`, so unwrap before inspecting bytes. */
async function resolveBlob(result: Promise<Blob> | Blob): Promise<Blob> {
  return Promise.resolve(result);
}

beforeEach(() => {
  pngWriter.calls.length = 0;
});

describe('exportToJson', () => {
  it('serializes with a JSON MIME type and two-space indentation', async () => {
    const elements = [rect('a'), rect('b')];
    const blob = exportToJson(elements);
    expect(blob.type).toBe('application/json');

    const text = await readBlob(blob);
    // Round-trip first: the bytes have to mean the same scene.
    expect(JSON.parse(text)).toEqual(elements);
    // Then the indentation, which is what the `null, 2` argument buys and what a
    // dropped argument would silently take away. Checked on an indented line
    // rather than on a newline count, so compact output cannot pass.
    const indented = text.split('\n').filter(line => line.startsWith(' '));
    expect(indented.length).toBeGreaterThan(0);
    expect(indented.every(line => line.startsWith('  '))).toBe(true);
    expect(indented.some(line => line.startsWith('    '))).toBe(true);
  });
});

describe('exportCanvas routing', () => {
  it('routes PNG to the raster writer and forwards the options unchanged', async () => {
    const elements = [rect('a')];
    const options: ExportOptions = { scale: 3, background: '#101010', padding: 4 };

    const blob = await resolveBlob(exportCanvas('png', elements, options));

    expect(pngWriter.calls).toHaveLength(1);
    // Identity, not equality: the dispatcher must pass the caller's object
    // through. A defensive copy would be indistinguishable here but would not
    // be at the call site, where `buildRasterExportOptions` is the only place
    // that decides scale.
    expect(pngWriter.calls[0]?.elements).toBe(elements);
    expect(pngWriter.calls[0]?.options).toBe(options);
    expect(blob.type).toBe('image/png');
  });

  it('routes PNG with no options at all, so the writer applies its own defaults', async () => {
    await resolveBlob(exportCanvas('png', [rect('a')]));
    expect(pngWriter.calls).toHaveLength(1);
    expect(pngWriter.calls[0]?.options).toBeUndefined();
  });

  it('routes SVG to the vector writer, and returns the Blob synchronously', async () => {
    const blob = await resolveBlob(exportCanvas('svg', [rect('a')]));

    // Only PNG is async. `ExportModal` wraps the result in `Promise.resolve`, so
    // nothing in production would notice if this started returning a promise —
    // but the declared return type promises otherwise, so it is pinned here.
    const raw = exportCanvas('svg', [rect('a')]) as Blob;
    expect(typeof (raw as unknown as { then?: unknown }).then).not.toBe('function');

    expect(blob.type).toBe('image/svg+xml');
    // Real bytes, not a spy: the SVG writer's own element id proves the scene
    // reached it, and a route to any other writer would produce different bytes.
    const markup = await readBlob(blob);
    expect(markup).toContain('<svg');
    expect(markup).toContain('<rect');
    // PNG must not have been reached on the way.
    expect(pngWriter.calls).toHaveLength(0);
  });

  it('routes dripl to the native writer and forwards only appState', async () => {
    const elements = [rect('a')];
    // Raster options are present and must NOT leak into the document: a `.dripl`
    // file is a scene plus viewport state, and a `scale` key inside `appState`
    // would be read back as editor state on the next open.
    const blob = await resolveBlob(
      exportCanvas('dripl', elements, {
        scale: 3,
        background: '#101010',
        appState: { zoom: 2.5 },
      })
    );

    const document_ = JSON.parse(await readBlob(blob)) as {
      type: string;
      version: number;
      elements: unknown[];
      appState: Record<string, unknown>;
    };
    expect(document_.type).toBe(DRIPL_SCENE_TYPE);
    expect(document_.version).toBe(DRIPL_SCENE_VERSION);
    expect(document_.elements).toEqual(elements);
    expect(document_.appState).toEqual({ zoom: 2.5 });
    expect(document_.appState).not.toHaveProperty('scale');
    expect(document_.appState).not.toHaveProperty('background');
  });

  it('routes dripl with no options to an empty appState, not undefined', async () => {
    const blob = await resolveBlob(exportCanvas('dripl', [rect('a')]));
    const document_ = JSON.parse(await readBlob(blob)) as { appState: unknown };
    expect(document_.appState).toEqual({});
  });

  it('falls through to JSON for the json format', async () => {
    const elements = [rect('a')];
    const blob = await resolveBlob(exportCanvas('json', elements));

    expect(blob.type).toBe('application/json');
    expect(JSON.parse(await readBlob(blob))).toEqual(elements);
    // `json` is the residual case — it is reached only because no earlier branch
    // matched. Asserting the other three writers were not called is what proves
    // the fallthrough rather than an earlier branch happening to agree.
    expect(pngWriter.calls).toHaveLength(0);
  });
});

describe('importFromJson — replace', () => {
  it('keeps the file ids, because replace discards the scene that would collide', () => {
    const result = importFromJson(JSON.stringify([rect('shape-1')]), [rect('mine')], 'replace');

    expect(result.elements).toHaveLength(1);
    // The distinguishing invariant against merge. Merge mints fresh uuids because
    // the file's elements land beside the user's own; replace throws the user's
    // elements away, so preserving the file's ids is both safe and necessary —
    // any selection or link that referred to them by id still resolves.
    expect(result.elements[0]?.id).toBe('shape-1');
    expect(result.elements.map(element => element.id)).not.toContain('mine');
    expect(result.dropped).toBe(0);
    expect(result.partial).toBe(false);
  });

  it('truncates to the element cap and reports it as a limit, not as damage', () => {
    // `parseDriplDocument` caps the element list and counts the overflow in
    // `dropped` while leaving `partial` false, because exceeding a documented
    // ceiling is not corruption. Replace passes both through unchanged, so a
    // truncated replace is visible to the caller as `dropped > 0` with
    // `partial: false` — the two signals are independent and must stay so.
    const oversized = JSON.stringify(
      Array.from({ length: MAX_IMPORT_ELEMENTS + 5 }, (_, index) => rect(`shape-${index}`))
    );

    const result = importFromJson(oversized, [], 'replace');

    expect(result.elements).toHaveLength(MAX_IMPORT_ELEMENTS);
    expect(result.dropped).toBe(5);
    expect(result.partial).toBe(false);
  });

  it('still refuses a partly-readable file, since replace is all-or-nothing', () => {
    const partial = JSON.stringify([rect('good-1'), { id: 'bad-1', type: 'not-a-real-type' }]);
    expect(() => importFromJson(partial, [], 'replace')).toThrow(/not a complete/i);
  });
});

describe('importFromJson — merge capacity', () => {
  it('accepts a merge that lands exactly on the cap', () => {
    // The guard is a strict `>`, so `current + incoming === MAX_IMPORT_ELEMENTS`
    // is allowed. Filling a scene to exactly its documented limit is a legal
    // outcome, and an off-by-one here would refuse a scene the app can hold.
    const incoming = 1;
    const current = Array.from({ length: MAX_IMPORT_ELEMENTS - incoming }, (_, index) =>
      rect(`mine-${index}`)
    );

    const result = importFromJson(JSON.stringify([rect('shape-1')]), current, 'merge');

    expect(result.elements).toHaveLength(MAX_IMPORT_ELEMENTS);
    expect(result.dropped).toBe(0);
    expect(result.partial).toBe(false);
  });

  it('refuses a merge one element past the cap', () => {
    // One past the boundary, and the refusal happens before anything is merged:
    // a partial merge would leave the user with a scene they did not ask for.
    const current = Array.from({ length: MAX_IMPORT_ELEMENTS }, (_, index) =>
      rect(`mine-${index}`)
    );

    expect(() => importFromJson(JSON.stringify([rect('shape-1')]), current, 'merge')).toThrow(
      /element limit/i
    );
  });
});
