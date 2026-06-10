const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3002';

export interface ImageUploadResult {
  id: string;
  url: string;
  size: number;
}

/**
 * Upload an image to the server blob storage
 */
export async function uploadImage(file: File): Promise<ImageUploadResult> {
  const res = await fetch(`${API_BASE}/api/images`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type,
    },
    body: file,
    credentials: 'include',
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(error.error ?? `Upload failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Get the URL for an image by ID
 */
export function getImageUrl(imageId: string): string {
  return `${API_BASE}/api/images/${imageId}`;
}

/**
 * Fetch an image as a blob
 */
export async function fetchImageBlob(imageId: string): Promise<Blob> {
  const res = await fetch(getImageUrl(imageId));
  if (!res.ok) {
    throw new Error(`Failed to fetch image: ${res.status}`);
  }
  return res.blob();
}
