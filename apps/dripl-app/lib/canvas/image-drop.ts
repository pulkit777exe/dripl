import type { DriplElement } from '@dripl/common';

/**
 * Image drop handling — extracted from `useCanvasPointerEvents`.
 *
 * Dragging image files onto the canvas uploads each one, measures it, and
 * centers a new image element on the drop point. Non-image files are
 * skipped and per-file failures are reported without aborting the rest.
 * I/O is injected so the orchestration is unit-testable.
 */

export interface DroppedImageDims {
  displayWidth: number;
  displayHeight: number;
}

export interface ImageDropDeps {
  uploadImage: (file: File) => Promise<string>;
  loadImageDims: (url: string, maxSize: number) => Promise<DroppedImageDims>;
  makeId: () => string;
  onElement: (element: DriplElement) => void;
  onError: (error: unknown) => void;
}

export async function dropImageFiles(
  files: File[],
  point: { x: number; y: number },
  deps: ImageDropDeps
): Promise<void> {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    try {
      const imageUrl = await deps.uploadImage(file);
      const dims = await deps.loadImageDims(imageUrl, 500);
      const element: DriplElement = {
        id: deps.makeId(),
        type: 'image',
        x: point.x - dims.displayWidth / 2,
        y: point.y - dims.displayHeight / 2,
        width: dims.displayWidth,
        height: dims.displayHeight,
        strokeColor: 'transparent',
        backgroundColor: 'transparent',
        strokeWidth: 0,
        opacity: 1,
        src: imageUrl,
      };
      deps.onElement(element);
    } catch (error) {
      deps.onError(error);
    }
  }
}
