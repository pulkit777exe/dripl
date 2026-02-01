import type { DriplElement, ImageElement } from "@dripl/common";

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
  baseProps: Omit<DriplElement, "type" | "x" | "y" | "width" | "height" | "src"> & { id: string }
): ImageElement {
  return {
    ...baseProps,
    type: "image",
    x: state.position.x,
    y: state.position.y,
    width: state.displayWidth,
    height: state.displayHeight,
    src: state.src,
  };
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
        src: typeof file === "string" ? file : URL.createObjectURL(file),
        naturalWidth: img.width,
        naturalHeight: img.height,
        displayWidth,
        displayHeight,
      });
    };

    img.onerror = reject;

    if (typeof file === "string") {
      img.src = file;
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    }
  });
}
