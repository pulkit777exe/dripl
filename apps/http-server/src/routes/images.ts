import { Router, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '@dripl/db';
import { authMiddleware, type AuthRequest } from '../middlewares/authMiddleware';
import { sendError } from '../lib/response';
import { logger } from '../logger';
import { assertImageKey, getImageStore, ImageStoreError, InvalidImageKeyError } from '../storage';

const router: ReturnType<typeof Router> = Router();

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Image bytes are immutable for a given id, but the id is also a revocation
 * capability. A one-year `immutable` lifetime meant a deleted object could keep
 * rendering from a browser cache long after the origin stopped serving it.
 * Sixty seconds bounds that window for caches that honour the header, and
 * `must-revalidate` stops a stale copy being served after it expires. The ETag
 * below turns the repeat fetch into a 304 when the object is still present.
 */
const IMAGE_CACHE_CONTROL = 'public, max-age=60, must-revalidate';

/**
 * How many leading bytes prove the declared type. 12 is the maximum any
 * supported format needs (WEBP's `RIFF....WEBP`), so every format's verdict
 * is final once 12 bytes are buffered — PNG needs 8, JPEG 3, GIF 6.
 */
const EARLY_SIGNATURE_BYTES = 12;

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

// POST /api/images — Upload image
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
      return;
    }

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
    // The first bytes seen, retained separately so the signature can be
    // checked without re-concatenating everything buffered so far. Capped at
    // EARLY_SIGNATURE_BYTES: once full it is never grown again.
    let prefix = Buffer.alloc(0);
    let prefixChecked = false;

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
      // Early reject: the declared type is attacker-chosen, and a body whose
      // first bytes already disprove it will never become valid no matter how
      // much more arrives — so refuse it now instead of buffering up to 10MB
      // of garbage first. The status and body are the same 400 INVALID_IMAGE
      // the end-of-stream check answers; only the timing changes.
      //
      // Ordering note: a body that is both over-large *and* misdeclared now
      // answers 400 rather than 413, because the mismatch is provable from
      // the first chunk while the size is not yet known. A body with an
      // honest header still streams to the cap and answers 413 there.
      if (!prefixChecked) {
        prefix = Buffer.concat([prefix, chunk]).subarray(0, EARLY_SIGNATURE_BYTES);
        if (prefix.length >= EARLY_SIGNATURE_BYTES) {
          prefixChecked = true;
          if (!hasValidImageSignature(prefix, baseType)) {
            if (!res.headersSent) {
              sendError(
                res,
                400,
                'INVALID_IMAGE',
                'File contents do not match the declared image type'
              );
            }
            req.destroy();
            return;
          }
        }
      }
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

        // The bytes and the ownership row are two stores, so this is the one
        // point where a partial success is possible. Record ownership after the
        // put; if that record fails, remove the object rather than leave an
        // image that nobody can later revoke. The reverse order would expose a
        // row pointing at nothing.
        try {
          await db.image.create({ data: { id: fileId, userId } });
        } catch (error) {
          await getImageStore()
            .delete(fileId)
            .catch(cleanupError => {
              logger.warn(
                {
                  event: 'image_ownership_cleanup_failed',
                  id: fileId,
                  error: cleanupError,
                },
                'Could not remove an image whose ownership record failed'
              );
            });
          throw error;
        }

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

    res.setHeader('Cache-Control', IMAGE_CACHE_CONTROL);
    // The id names write-once bytes: uploads always generate a fresh id and
    // never overwrite an existing key. That makes the id a stable strong
    // validator without hashing the body on every request.
    res.setHeader('ETag', `"${key}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // The URL itself is the capability. Permit canvas/export consumers to
    // read the raster cross-origin without making the response credentialed.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    // `req.fresh` performs the RFC 9110 weak comparison against If-None-Match,
    // including `*` and comma-separated lists. Reaching it here means the
    // object was found, so a match is safe to answer without the body.
    if (req.fresh) {
      res.status(304).end();
      return;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', body.length);
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

// DELETE /api/images/:id — Revoke an uploaded image
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }

  try {
    const id = req.params.id as string;
    const key = assertImageKey(id);

    // A missing row and another user's row intentionally share one 404: the id
    // is the capability, and a 403 would confirm that a guessed id exists.
    // Pre-existing images have no row, so they are not revocable by this route
    // and fall into the same 404 rather than granting deletion to whichever
    // authenticated caller presents the URL.
    const owned = await db.image.findFirst({
      where: { id: key, userId },
      select: { id: true },
    });
    if (!owned) {
      sendError(res, 404, 'NOT_FOUND', 'Image not found');
      return;
    }

    // Storage first. If it fails the row survives, so the owner can retry; if
    // the row were removed first and storage failed, the capability would be
    // gone from the database while the bytes stayed readable.
    await getImageStore().delete(key);
    await db.image.deleteMany({ where: { id: key, userId } });

    res.status(204).end();
  } catch (error) {
    if (error instanceof InvalidImageKeyError) {
      sendError(res, 400, 'INVALID_IMAGE_ID', 'Invalid image id');
      return;
    }
    if (error instanceof ImageStoreError) {
      reportStorageFailure('delete', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Failed to delete image');
      return;
    }
    logger.error({ event: 'image_delete_error', error }, 'Image delete error');
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to delete image');
  }
});

function reportStorageFailure(operation: 'upload' | 'download' | 'delete', error: unknown): void {
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
