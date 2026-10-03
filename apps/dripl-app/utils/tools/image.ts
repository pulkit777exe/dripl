import type { DriplElement, ImageElement } from '@dripl/common';
import { uploadImage, getImageUrl } from '@/utils/api/images';

export interface ImageToolState {
  position: { x: number; y: number };
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  displayWidth: number;
  displayHeight: number;
}

/**
 * Create an image element
 */
export function createImageElement(
  state: ImageToolState,
  baseProps: Omit<DriplElement, 'type' | 'x' | 'y' | 'width' | 'height' | 'src'> & { id: string }
): ImageElement {
  return {
    ...baseProps,
    type: 'image',
    x: state.position.x,
    y: state.position.y,
    width: state.displayWidth,
    height: state.displayHeight,
    src: state.src,
  };
}

/**
 * Upload image to server and return the image URL
 */
export async function uploadImageToServer(file: File): Promise<string> {
  const result = await uploadImage(file);
  return getImageUrl(result.id);
}

/**
 * Load image and calculate display dimensions
 */
export async function loadImage(
  file: File | string,
  maxSize: number = 1000
): Promise<{
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  displayWidth: number;
  displayHeight: number;
}> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      let displayWidth = img.width;
      let displayHeight = img.height;

      // Scale down if too large
      if (displayWidth > maxSize || displayHeight > maxSize) {
        const ratio = Math.min(maxSize / displayWidth, maxSize / displayHeight);
        displayWidth *= ratio;
        displayHeight *= ratio;
      }

      resolve({
        src: typeof file === 'string' ? file : URL.createObjectURL(file),
        naturalWidth: img.width,
        naturalHeight: img.height,
        displayWidth,
        displayHeight,
      });
    };

    // Handing `reject` straight to an event handler is a trap: the rejection
    // reason becomes whatever the DOM event happens to carry, so callers get
    // something that is not an `Error`. In a browser that is an opaque `Event`
    // with no `message`; under jsdom it is `undefined`. Either way
    // `catch (e) { e.message }` yields nothing — and the log line the caller
    // writes names the wrong step, because by this point the upload has already
    // succeeded and it is the decode that failed.
    const describeSource = (): string => {
      const raw =
        typeof file === 'string'
          ? file
          : `File(${file.name || 'unnamed'}, ${file.type || 'unknown type'})`;
      // A File source is read as a data URL, so never echo an unbounded one.
      return raw.length > 120 ? `${raw.slice(0, 117)}...` : raw;
    };

    img.onerror = () => reject(new Error(`Failed to decode image: ${describeSource()}`));

    if (typeof file === 'string') {
      img.src = file;
    } else {
      const reader = new FileReader();
      reader.onload = e => {
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error(`Failed to read image: ${describeSource()}`));
      reader.readAsDataURL(file);
    }
  });
}
