import { Router, type Response } from 'express';
import { randomUUID } from 'crypto';
import { mkdir, writeFile, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { authMiddleware, type AuthRequest } from '../middlewares/authMiddleware';

const router: ReturnType<typeof Router> = Router();

const IMAGE_STORAGE_DIR = process.env.IMAGE_STORAGE_DIR ?? join(process.cwd(), 'uploads', 'images');
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

const ALLOWED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

async function ensureStorageDir() {
  if (!existsSync(IMAGE_STORAGE_DIR)) {
    await mkdir(IMAGE_STORAGE_DIR, { recursive: true });
  }
}

function getImagePath(id: string): string {
  // Prevent path traversal
  const safeId = id.replace(/[^a-zA-Z0-9.-]/g, '');
  return join(IMAGE_STORAGE_DIR, safeId);
}

// POST /api/images — Upload image
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    await ensureStorageDir();

    const contentType = req.headers['content-type'];
    const baseType = contentType?.split(';')[0]?.trim();
    if (!baseType || !ALLOWED_TYPES.has(baseType)) {
      res.status(400).json({ error: 'Invalid content type. Allowed: png, jpeg, gif, webp, svg' });
      return;
    }

    // Collect raw body chunks
    const chunks: Buffer[] = [];
    let totalSize = 0;

    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_IMAGE_SIZE) {
        if (!res.headersSent) {
          res.status(413).json({ error: 'Image too large. Maximum size is 10MB.' });
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
        const id = randomUUID();
        const ext = getExtensionFromContentType(baseType);
        const fileId = `${id}.${ext}`;

        await writeFile(getImagePath(fileId), buffer);

        const baseUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
        const url = `${baseUrl}/api/images/${fileId}`;

        res.status(201).json({ id: fileId, url, size: buffer.length });
      } catch (error) {
        console.error('Image upload failed:', error);
        res.status(500).json({ error: 'Failed to save image' });
      }
    });

    req.on('error', (error) => {
      console.error('Image upload stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Upload failed' });
      }
    });
  } catch (error) {
    console.error('Image upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// GET /api/images/:id — Download image
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const filePath = getImagePath(id);

    if (!existsSync(filePath)) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }

    const fileStat = await stat(filePath);
    const contentType = getContentTypeFromId(id);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', fileStat.size);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    const buffer = await readFile(filePath);
    res.send(buffer);
  } catch (error) {
    console.error('Image download error:', error);
    res.status(500).json({ error: 'Failed to read image' });
  }
});

function getExtensionFromContentType(contentType: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
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
    svg: 'image/svg+xml',
  };
  return map[ext ?? ''] ?? 'application/octet-stream';
}

export { router as imagesRouter };
