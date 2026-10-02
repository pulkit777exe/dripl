import { apiClient } from '@/lib/api';

const configuredApiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3002';
const API_BASE = configuredApiBase.endsWith('/api')
  ? configuredApiBase
  : `${configuredApiBase.replace(/\/$/, '')}/api`;

export interface ImageUploadResult {
  id: string;
  url: string;
  size: number;
}

/**
 * Upload an image to the server blob storage.
 * The API client owns CSRF-token initialization so this direct binary
 * request follows the same mutation contract as JSON requests.
 */
export async function uploadImage(file: File): Promise<ImageUploadResult> {
  const csrfToken = await apiClient.getCsrfToken();
  const res = await fetch(`${API_BASE}/images`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type,
      'x-csrf-token': csrfToken,
    },
    body: file,
    credentials: 'include',
  });

  if (!res.ok) {
    const error = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(error.error ?? `Upload failed: ${res.status}`);
  }

  return res.json() as Promise<ImageUploadResult>;
}

/**
 * Get the URL for an image by ID.
 */
export function getImageUrl(imageId: string): string {
  return `${API_BASE}/images/${encodeURIComponent(imageId)}`;
}

/**
 * Fetch an image as a blob.
 */
export async function fetchImageBlob(imageId: string): Promise<Blob> {
  const res = await fetch(getImageUrl(imageId), { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`Failed to fetch image: ${res.status}`);
  }
  return res.blob();
}
