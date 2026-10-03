import { Router, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { authMiddleware, type AuthRequest } from '../middlewares/authMiddleware';
import { sendError } from '../lib/response';
import { logger } from '../logger';
import { assertImageKey, getImageStore, ImageStoreError, InvalidImageKeyError } from '../storage';

const router: ReturnType<typeof Router> = Router();

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

// POST /api/images — Upload image
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const contentType = req.headers['content-type'];
    const baseType = contentType?.split(';')[0]?.trim();
    if (!baseType || !ALLOWED_TYPES.has(baseType)) {
      sendError(
        res,
        400,
        'INVALID_CONTENT_TYPE',
        'Invalid content type. Allowed: png, jpeg, gif, webp'
      );
      return;
    }

    // Collect raw body chunks
    const chunks: Buffer[] = [];
    let totalSize = 0;

    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_IMAGE_SIZE) {
        if (!res.headersSent) {
          sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Image too large. Maximum size is 10MB.');
        }
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', async () => {
      if (res.headersSent) return;
      try {
        const buffer = Buffer.concat(chunks);
        if (!hasValidImageSignature(buffer, baseType)) {
          sendError(
            res,
            400,
            'INVALID_IMAGE',
            'File contents do not match the declared image type'
          );
          return;
        }
        const id = randomUUID();
        const ext = getExtensionFromContentType(baseType);
        const fileId = `${id}.${ext}`;

        await getImageStore().put(fileId, buffer, baseType);

        const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3002/api';
        const apiBase = configuredApiUrl.endsWith('/api')
          ? configuredApiUrl
          : `${configuredApiUrl.replace(/\/$/, '')}/api`;
        const url = `${apiBase}/images/${fileId}`;

        res.status(201).json({ id: fileId, url, size: buffer.length });
      } catch (error) {
        reportStorageFailure('upload', error);
        logger.error({ event: 'image_upload_save_error', error }, 'Image upload failed');
        sendError(res, 500, 'INTERNAL_ERROR', 'Failed to save image');
      }
    });

    req.on('error', error => {
      logger.error({ event: 'image_upload_stream_error', error }, 'Image upload stream error');
      if (!res.headersSent) {
        sendError(res, 500, 'INTERNAL_ERROR', 'Upload failed');
      }
    });
  } catch (error) {
    logger.error({ event: 'image_upload_error', error }, 'Image upload error');
    sendError(res, 500, 'INTERNAL_ERROR', 'Upload failed');
  }
});

// GET /api/images/:id — Download image
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    // Validation is the first thing that happens, before the store is even
    // resolved: an id that is not in our own generated format never reaches a
    // filesystem path or a URL.
    const key = assertImageKey(id);

    const body = await getImageStore().get(key);
    if (!body) {
      sendError(res, 404, 'NOT_FOUND', 'Image not found');
      return;
    }

    const contentType = getContentTypeFromId(id);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', body.length);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // The URL itself is the capability. Permit canvas/export consumers to
    // read the raster cross-origin without making the response credentialed.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    res.send(body);
  } catch (error) {
    if (error instanceof InvalidImageKeyError) {
      sendError(res, 400, 'INVALID_IMAGE_ID', 'Invalid image id');
      return;
    }
    if (error instanceof ImageStoreError) {
      // A store that is unreachable fails the request; it never falls back to
      // local disk. Two sources of truth is the failure mode this swap exists
      // to remove, and a silent fallback would reintroduce it invisibly — the
      // only symptom would be a `GET` succeeding for an image the `PUT` never
      // stored, on whichever replica happened to hold a copy.
      reportStorageFailure('download', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Failed to read image');
      return;
    }
    logger.error({ event: 'image_download_error', error }, 'Image download error');
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to read image');
  }
});

function reportStorageFailure(operation: 'upload' | 'download', error: unknown): void {
  if (!(error instanceof ImageStoreError)) return;
  logger.warn(
    {
      event: 'image_store_failure',
      operation,
      code: error.code,
      kind: error.storeKind,
      retryable: error.retryable,
      status: error.status,
      reason: error.message,
    },
    'Image storage request failed'
  );
}

function hasValidImageSignature(buffer: Buffer, contentType: string): boolean {
  switch (contentType) {
    case 'image/png':
      return (
        buffer.length >= 8 &&
        buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      );
    case 'image/jpeg':
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case 'image/gif':
      return buffer.length >= 6 && buffer.subarray(0, 6).toString('ascii').startsWith('GIF8');
    case 'image/webp':
      return (
        buffer.length >= 12 &&
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP'
      );
    default:
      return false;
  }
}

function getExtensionFromContentType(contentType: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
  };
  return map[contentType] ?? 'bin';
}

function getContentTypeFromId(id: string): string {
  const ext = id.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
  };
  return map[ext ?? ''] ?? 'application/octet-stream';
}

export { router as imagesRouter };
