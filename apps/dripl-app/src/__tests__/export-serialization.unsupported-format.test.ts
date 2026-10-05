import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriplElement } from '@dripl/common';
import type { ExportFormat } from '@/components/canvas/export/exportTypes';
import { exportCanvas } from '@/utils/export/serialization';

/**
 * `exportCanvas` — what it does with a format it does not handle.
 *
 * `export-serialization.dispatch.test.ts` covers the routing of the four
 * supported formats, and `ExportModal.test.tsx` covers the `'pdf'` branch that
 * returns before the dispatcher is ever called. Neither of those pins the
 * dispatcher's own terminal case, because both sit *outside* it: the modal test
 * only proves the current call order is right, and it would keep passing if
 * `exportCanvas` grew a residual `return exportToJson(elements)` — the exact
 * combination that downloads a JSON payload under the name `*.pdf`.
 *
 * So this file calls `exportCanvas` with a format outside its parameter type,
 * the way a value that escaped type-checking arrives in practice: a widened
 * `ExportFormat`, a string read from the URL or from persisted state. TypeScript
 * erases the union; the dispatcher has to refuse the value on its own.
 *
 * All three writers are mocked so that "routes to its own writer" is proved by
 * *which* spy fired, not by the returned MIME type — `.dripl` and `.json` are
 * both `application/json`, so bytes cannot tell those two apart.
 */

/** The option bag the dispatcher forwards. */
interface ExportOptions {
  scale?: number;
  background?: string;
  padding?: number;
  customWidth?: number;
  customHeight?: number;
  appState?: Record<string, unknown>;
}

type DispatcherFormat = Parameters<typeof exportCanvas>[0];
type WriterName = 'png' | 'svg' | 'dripl';

/**
 * The three writers, each recording its own calls. `vi.hoisted` because
 * `vi.mock` factories are hoisted above the module's own imports.
 */
const writers = vi.hoisted(() => {
  const calls = { png: [] as unknown[][], svg: [] as unknown[][], dripl: [] as unknown[][] };
  return {
    calls,
    exportToPng: (elements: unknown, options?: unknown) => {
      calls.png.push([elements, options]);
      return Promise.resolve(new Blob(['png-bytes'], { type: 'image/png' }));
    },
    exportToSvg: (elements: unknown, options?: unknown) => {
      calls.svg.push([elements, options]);
      return new Blob(['<svg/>'], { type: 'image/svg+xml' });
    },
    exportToDripl: (elements: unknown, appState?: unknown) => {
      calls.dripl.push([elements, appState]);
      return new Blob(['dripl-bytes'], { type: 'application/json' });
    },
  };
});

vi.mock('@/utils/export/raster', () => ({
  exportToPng: writers.exportToPng,
  generateThumbnail: (): Promise<string> => Promise.resolve(''),
}));

vi.mock('@/utils/export/vector', () => ({ exportToSvg: writers.exportToSvg }));

vi.mock('@/utils/export/native', async importOriginal => {
  // Only the writer is captured. `MAX_IMPORT_ELEMENTS` is re-exported by
  // `serialization.ts` at module scope, so the module has to stay complete.
  const actual = await importOriginal<typeof import('@/utils/export/native')>();
  return { ...actual, exportToDripl: writers.exportToDripl };
});

const rect = (id: string): DriplElement =>
  ({ id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }) as DriplElement;

/**
 * Hand the dispatcher a value it was told it could never receive.
 *
 * A single assertion, and the shape matters: the parameter type is assignable
 * to `string`, so `string → union` is a legal narrowing without an `unknown`
 * hop. That is the real direction of the hazard — a format that arrived as a
 * plain string and was never checked — so the test models it exactly.
 */
function uncheckedFormat(format: string): DispatcherFormat {
  return format as DispatcherFormat;
}

/** Every spy, so "no writer ran" is one assertion rather than three. */
function writerCallCounts(): Record<WriterName, number> {
  return {
    png: writers.calls.png.length,
    svg: writers.calls.svg.length,
    dripl: writers.calls.dripl.length,
  };
}

beforeEach(() => {
  writers.calls.png.length = 0;
  writers.calls.svg.length = 0;
  writers.calls.dripl.length = 0;
});

describe('exportCanvas — supported formats still route to their own writer', () => {
  const cases: Array<{ format: DispatcherFormat; writer: WriterName }> = [
    { format: 'png', writer: 'png' },
    { format: 'svg', writer: 'svg' },
    { format: 'dripl', writer: 'dripl' },
  ];

  it.each(cases)(
    'routes $format to the $writer writer and no other',
    async ({ format, writer }) => {
      const elements = [rect('a')];
      const options: ExportOptions = { scale: 2, background: '#101010', appState: { zoom: 2 } };

      // `json` is the fourth format and has no writer of its own — it is the JSON
      // serialiser itself, defined in the module under test, so it cannot be
      // spied on. It is asserted separately below; these three are the routes a
      // wrong branch would silently take.
      const blob = await Promise.resolve(exportCanvas(format, elements, options));

      expect(writerCallCounts()).toEqual({
        png: writer === 'png' ? 1 : 0,
        svg: writer === 'svg' ? 1 : 0,
        dripl: writer === 'dripl' ? 1 : 0,
      });
      expect(blob.type).toBe(
        writer === 'png' ? 'image/png' : writer === 'svg' ? 'image/svg+xml' : 'application/json'
      );
      // Identity, not equality: the dispatcher must forward the caller's own
      // element array. A copy or a re-serialise would be invisible in the bytes
      // but would be a behaviour change at the call site, where
      // `resolveExportScope` already decided what is being exported.
      const forwarded = {
        png: writers.calls.png[0]?.[0],
        svg: writers.calls.svg[0]?.[0],
        dripl: writers.calls.dripl[0]?.[0],
      };
      expect(forwarded[writer]).toBe(elements);
    }
  );

  it('routes json to the JSON serialiser, and to nothing else', async () => {
    const elements = [rect('a')];
    const blob = await Promise.resolve(exportCanvas('json', elements));

    expect(blob.type).toBe('application/json');
    expect(writerCallCounts()).toEqual({ png: 0, svg: 0, dripl: 0 });
  });
});

describe('exportCanvas — terminal rejection', () => {
  // `''` is in this list on purpose: it is what a `URLSearchParams.get()` miss
  // or a defaulted persisted value looks like, and it is the case a residual
  // fallthrough would turn into a silently downloaded file with no complaint.
  const unhandled: readonly string[] = ['pdf', 'clipboard', 'PDF', 'json5', ''];

  it.each(unhandled)('rejects "%s" instead of serialising it', format => {
    expect(() => exportCanvas(uncheckedFormat(format), [rect('a')])).toThrow(
      /unsupported export format/i
    );
    // And it rejects *before* any writer: a guard that ran the dispatch first
    // and complained afterwards would still have produced bytes on the way.
    expect(writerCallCounts()).toEqual({ png: 0, svg: 0, dripl: 0 });
  });

  it('names the offending value, so the log says which format was refused', () => {
    // The message has to carry the value that actually arrived. Under the old
    // residual `return exportToJson(elements)`, everything past the last `if`
    // was typed `'json'`, so a naive rejection message there would have named
    // the one format that does work and sent whoever reads the log in circles.
    expect(() => exportCanvas(uncheckedFormat('pdf'), [rect('a')])).toThrow(
      'Unsupported export format: "pdf"'
    );
  });

  it('throws synchronously rather than returning a value or a pending promise', () => {
    // Every caller writes `await Promise.resolve(exportCanvas(...))` inside a
    // `try`, so a synchronous throw lands in the caller's existing "export
    // failed" path and no call site has to change. A returned promise that
    // rejected would be safe only for as long as every caller keeps awaiting
    // inside a `try`: a caller that chained `.then(downloadBlob)` outside one
    // would get an unhandled rejection instead of a visible error. A
    // synchronous throw cannot be swallowed that way, so that is the shape
    // pinned here.
    let returned: unknown = 'no call was made';
    expect(() => {
      returned = exportCanvas(uncheckedFormat('pdf'), [rect('a')]);
    }).toThrow();
    expect(returned).toBe('no call was made');
  });

  it('refuses a format the caller forgot to handle, so a moved early return cannot guard it', () => {
    // The dangerous call, written out. `ExportModal` holds a wide `ExportFormat`
    // and drops `'pdf'` with an early return immediately before calling the
    // dispatcher; this is that call with the drop removed. Today it needs an
    // assertion to compile, which is the type system doing its half of the job;
    // this assertion is the runtime half doing the other. If someone moved the
    // early return and reached for the same shortcut, the guard would still
    // refuse the export — the user would see an error instead of a `.pdf` file
    // holding JSON.
    const wide: ExportFormat = 'pdf';
    const dispatchWithoutTheEarlyReturn = (
      format: ExportFormat,
      elements: DriplElement[]
    ): Promise<Blob> | Blob => exportCanvas(format as DispatcherFormat, elements);

    expect(() => dispatchWithoutTheEarlyReturn(wide, [rect('a')])).toThrow(
      /unsupported export format: "pdf"/i
    );
    expect(writerCallCounts()).toEqual({ png: 0, svg: 0, dripl: 0 });
  });
});
