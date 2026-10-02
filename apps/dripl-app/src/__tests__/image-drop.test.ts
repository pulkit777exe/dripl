import { describe, expect, it, vi } from 'vitest';
import type { DriplElement } from '@dripl/common';
import { dropImageFiles, type ImageDropDeps } from '@/lib/canvas/image-drop';

function file(name: string, type: string): File {
  return new File(['bytes'], name, { type });
}

function deps(overrides: Partial<ImageDropDeps> = {}) {
  const onElement = vi.fn();
  const onError = vi.fn();
  return {
    onElement,
    onError,
    uploadImage: vi.fn(async (f: File) => `https://cdn.example/${f.name}`),
    loadImageDims: vi.fn(async () => ({ displayWidth: 200, displayHeight: 100 })),
    makeId: () => 'img-1',
    ...overrides,
  };
}

describe('dropImageFiles', () => {
  it('centers an uploaded image on the drop point', async () => {
    const d = deps();
    await dropImageFiles([file('a.png', 'image/png')], { x: 50, y: 60 }, d);

    expect(d.uploadImage).toHaveBeenCalledTimes(1);
    expect(d.loadImageDims).toHaveBeenCalledWith('https://cdn.example/a.png', 500);
    expect(d.onElement).toHaveBeenCalledTimes(1);
    const el = vi.mocked(d.onElement).mock.calls[0]![0] as DriplElement;
    expect(el).toMatchObject({
      id: 'img-1',
      type: 'image',
      x: -50,
      y: 10,
      width: 200,
      height: 100,
      src: 'https://cdn.example/a.png',
    });
    expect(d.onError).not.toHaveBeenCalled();
  });

  it('skips non-image files and keeps going after a failure', async () => {
    const d = deps({
      uploadImage: vi.fn(async (f: File) => {
        if (f.name === 'bad.png') throw new Error('upload down');
        return `https://cdn.example/${f.name}`;
      }),
    });
    await dropImageFiles(
      [file('notes.txt', 'text/plain'), file('bad.png', 'image/png'), file('ok.png', 'image/png')],
      { x: 0, y: 0 },
      d
    );

    expect(d.uploadImage).toHaveBeenCalledTimes(2);
    expect(d.onElement).toHaveBeenCalledTimes(1);
    expect(d.onError).toHaveBeenCalledTimes(1);
  });
});
