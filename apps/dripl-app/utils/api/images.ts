import { apiClient } from '@/lib/api';

/**
 * `NEXT_PUBLIC_API_URL` is documented as including the `/api` suffix
 * (`.env.example`, `docker-compose.yml`). Tolerate the variants anyway, but
 * strip trailing slashes FIRST: `'.../api/'.endsWith('/api')` is false, so
 * checking before normalising appended a second `/api` and every upload and
 * download 404'd against `.../api/api/images`.
 *
 * Note `lib/api.ts` takes the same variable verbatim. The two disagree for a
 * bare origin — this module appends `/api`, that one does not — and
 * `apps/http-server/src/routes/images.ts` normalises the same way this module
 * does, which leaves `lib/api.ts` as the odd one out of three.
 */
const configuredApiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3002';
const apiBaseWithoutTrailingSlash = configuredApiBase.replace(/\/+$/, '');
const API_BASE = apiBaseWithoutTrailingSlash.endsWith('/api')
  ? apiBaseWithoutTrailingSlash
  : `${apiBaseWithoutTrailingSlash}/api`;

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
    const error = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    // `message` first, `error` second, exactly as `lib/api.ts`'s `parseError`
    // does. The server's `sendError` puts a machine CODE in `error`
    // ('PAYLOAD_TOO_LARGE') and the human sentence in `message` ('Image too
    // large. Maximum size is 10MB.'), so preferring `error` showed users a
    // status code where the server meant to show a sentence.
    throw new Error(error.message ?? error.error ?? `Upload failed: ${res.status}`);
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
