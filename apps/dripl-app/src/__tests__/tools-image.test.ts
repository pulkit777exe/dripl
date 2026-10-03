import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DriplElementSchema } from '@dripl/common';
import type { DriplElement } from '@dripl/common';
import { createImageElement, loadImage, uploadImageToServer } from '@/utils/tools/image';
import { baseProps } from './helpers/elements';

/**
 * `utils/tools/image.ts` — the canvas-side half of image insertion.
 *
 * `utils/api/images.ts` is the transport and is covered in
 * `utils-api-images.test.ts`; here it is mocked, so these tests pin the tool's
 * own contract: the element it builds, the id-to-url step, and the sizing
 * arithmetic in `loadImage`.
 */

const uploadModule = vi.hoisted(() => ({
  uploadImage: vi.fn<(file: File) => Promise<{ id: string; url: string; size: number }>>(),
  getImageUrl: vi.fn<(id: string) => string>(),
}));

vi.mock('@/utils/api/images', () => uploadModule);

/**
 * A controllable `Image`.
 *
 * jsdom does not decode images, so the constructor is replaced with one that
 * reports a fixed intrinsic size and fires `onload` on a microtask once a src
 * is assigned — the same order a browser uses.
 */
function stubImage(intrinsic: { width: number; height: number }): { sources: string[] } {
  const sources: string[] = [];
  class StubImage {
    width = intrinsic.width;
    height = intrinsic.height;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(value: string) {
      sources.push(value);
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal('Image', StubImage);
  return { sources };
}

beforeEach(() => {
  uploadModule.uploadImage.mockReset();
  uploadModule.getImageUrl.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createImageElement', () => {
  const state = {
    position: { x: 40, y: 60 },
    src: 'https://api.example.com/api/images/a.png',
    naturalWidth: 400,
    naturalHeight: 200,
    displayWidth: 100,
    displayHeight: 50,
  };

  it('takes position and display size from the state, and the url verbatim', () => {
    const element = createImageElement(state, baseProps('i') as never);
    expect(element.type).toBe('image');
    expect([element.x, element.y, element.width, element.height]).toEqual([40, 60, 100, 50]);
    expect((element as { src: string }).src).toBe(state.src);
  });

  it('ignores the natural size, because the element is laid out in display units', () => {
    const element = createImageElement(state, baseProps('i') as never);
    expect(element.width).not.toBe(state.naturalWidth);
  });

  it('preserves the base props', () => {
    const props = baseProps('i');
    const element = createImageElement(state, props as never);
    for (const [key, value] of Object.entries(props)) {
      expect((element as Record<string, unknown>)[key]).toEqual(value);
    }
  });

  it('cannot be overridden on the fields it owns', () => {
    const element = createImageElement(state, {
      ...baseProps('i'),
      type: 'rectangle',
      src: 'https://evil',
      x: 1,
      width: 2,
    } as never);
    expect(element.type).toBe('image');
    expect((element as { src: string }).src).toBe(state.src);
    expect(element.x).toBe(40);
    expect(element.width).toBe(100);
  });

  it('produces a schema-valid element for an https source', () => {
    expect(
      DriplElementSchema.safeParse(
        createImageElement(state, baseProps('i') as never) as DriplElement
      ).success
    ).toBe(true);
  });
});

describe('uploadImageToServer', () => {
  it('turns the stored id into a download url, ignoring the url the server echoed', () => {
    // The server's echoed `url` is derived from ITS view of NEXT_PUBLIC_API_URL,
    // which may not be the browser's. The id is the only thing both agree on.
    uploadModule.uploadImage.mockResolvedValue({
      id: 'stored.png',
      url: 'http://localhost:3002/api/images/stored.png',
      size: 5,
    });
    uploadModule.getImageUrl.mockReturnValue('https://cdn.example.com/api/images/stored.png');
    const file = new File(['x'], 'a.png', { type: 'image/png' });

    return expect(uploadImageToServer(file))
      .resolves.toBe('https://cdn.example.com/api/images/stored.png')
      .then(() => {
        expect(uploadModule.uploadImage).toHaveBeenCalledWith(file);
        expect(uploadModule.getImageUrl).toHaveBeenCalledWith('stored.png');
      });
  });

  it('propagates an upload failure unchanged and never builds a url', async () => {
    uploadModule.uploadImage.mockRejectedValue(new Error('Image too large. Maximum size is 10MB.'));
    await expect(
      uploadImageToServer(new File(['x'], 'a.png', { type: 'image/png' }))
    ).rejects.toThrow('Image too large. Maximum size is 10MB.');
    expect(uploadModule.getImageUrl).not.toHaveBeenCalled();
  });
});

describe('loadImage: sizing', () => {
  it('reports the intrinsic size and passes a string src straight through', async () => {
    const { sources } = stubImage({ width: 300, height: 150 });
    await expect(loadImage('https://cdn/a.png')).resolves.toEqual({
      src: 'https://cdn/a.png',
      naturalWidth: 300,
      naturalHeight: 150,
      displayWidth: 300,
      displayHeight: 150,
    });
    expect(sources).toEqual(['https://cdn/a.png']);
  });

  it('leaves a fitting image at its intrinsic size', async () => {
    stubImage({ width: 800, height: 600 });
    const result = await loadImage('https://cdn/a.png');
    expect([result.displayWidth, result.displayHeight]).toEqual([800, 600]);
  });

  it('scales a wide image by its width', async () => {
    // 2000x1000 into a 1000px box halves both.
    stubImage({ width: 2000, height: 1000 });
    const result = await loadImage('https://cdn/a.png');
    expect([result.displayWidth, result.displayHeight]).toEqual([1000, 500]);
    // ...while the intrinsic size is reported untouched.
    expect([result.naturalWidth, result.naturalHeight]).toEqual([2000, 1000]);
  });

  it('scales a tall image by its height', async () => {
    stubImage({ width: 500, height: 4000 });
    const result = await loadImage('https://cdn/a.png');
    expect([result.displayWidth, result.displayHeight]).toEqual([125, 1000]);
  });

  it('honours a custom maxSize', async () => {
    stubImage({ width: 1000, height: 500 });
    const result = await loadImage('https://cdn/a.png', 250);
    expect([result.displayWidth, result.displayHeight]).toEqual([250, 125]);
  });

  it('never scales up an image smaller than maxSize', async () => {
    stubImage({ width: 10, height: 10 });
    const result = await loadImage('https://cdn/a.png', 5000);
    expect([result.displayWidth, result.displayHeight]).toEqual([10, 10]);
  });

  it('never reports a display size outside the box, and always keeps the aspect ratio', async () => {
    const cases = [
      { width: 1, height: 1 },
      { width: 999, height: 1 },
      { width: 1, height: 999 },
      { width: 5000, height: 3 },
      { width: 3, height: 5000 },
      { width: 4000, height: 4000 },
    ];
    for (const intrinsic of cases) {
      stubImage(intrinsic);
      const result = await loadImage('https://cdn/a.png', 1000);
      expect(Math.max(result.displayWidth, result.displayHeight)).toBeLessThanOrEqual(1000);
      expect(result.displayWidth / result.displayHeight).toBeCloseTo(
        intrinsic.width / intrinsic.height,
        6
      );
      // Only ever shrinks.
      expect(result.displayWidth).toBeLessThanOrEqual(intrinsic.width + 1e-9);
      expect(result.displayHeight).toBeLessThanOrEqual(intrinsic.height + 1e-9);
    }
  });

  it('reports finite dimensions for every intrinsic size', async () => {
    for (const intrinsic of [
      { width: 0, height: 0 },
      { width: 0, height: 500 },
      { width: 500, height: 0 },
      { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER },
    ]) {
      stubImage(intrinsic);
      const result = await loadImage('https://cdn/a.png', 500);
      expect(Number.isFinite(result.displayWidth)).toBe(true);
      expect(Number.isFinite(result.displayHeight)).toBe(true);
    }
  });
});

describe('loadImage: File sources', () => {
  it('reads the File as a data URL but hands back the object URL', async () => {
    // The canvas draws the object URL (cheap, no giant base64 string in memory)
    // and the upload posts the original File, so the returned src must be the
    // object URL even though the decode went through the data URL.
    const { sources } = stubImage({ width: 40, height: 20 });
    const createObjectURL = vi.fn().mockReturnValue('blob:fake-url');
    vi.stubGlobal('URL', Object.assign(Object.create(URL) as URL, { createObjectURL }));
    const file = new File(['bytes'], 'a.png', { type: 'image/png' });

    const result = await loadImage(file);

    expect(sources[0]).toMatch(/^data:/);
    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(result.src).toBe('blob:fake-url');
    expect(result.naturalWidth).toBe(40);
  });

  /**
   * A broken image URL rejects with NO reason.
   *
   * `img.onerror = reject` hands the browser's event straight to the promise's
   * reject, which the promise ignores, so the rejection value is `undefined`.
   * Both callers log the caught value ("Failed to upload image: <here>"), so a
   * broken URL produces a log line ending in `undefined` and nothing else.
   * Reported rather than fixed: giving it a reason means inventing an Error,
   * which is a behaviour change nobody asked for.
   */
  it('rejects with no reason when the image fails to load', async () => {
    class FailingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('Image', FailingImage);
    await expect(loadImage('https://cdn/broken.png')).rejects.toBeUndefined();
  });

  it('rejects with no reason when reading the File fails, never hanging', async () => {
    class UnusedImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', UnusedImage);
    class FailingReader {
      onload: unknown = null;
      onerror: unknown = null;
      readAsDataURL() {
        queueMicrotask(() => (this.onerror as (() => void) | null)?.());
      }
    }
    vi.stubGlobal('FileReader', FailingReader);
    // `reader.onerror = reject` has the same reason-less rejection as the image
    // path; what matters here is that the promise settles instead of hanging.
    await expect(loadImage(new File(['x'], 'a.png'))).rejects.toBeUndefined();
  });
});
