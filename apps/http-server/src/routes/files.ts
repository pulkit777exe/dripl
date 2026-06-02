import { randomBytes, createHash } from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { FileService } from '../services/fileService';

const listFilesQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  folderId: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().optional(),
});

const createFileSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  folderId: z.string().trim().min(1).nullable().optional(),
  content: z.unknown().optional(),
  preview: z.string().nullable().optional(),
});

const patchFileSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  content: z.unknown().optional(),
  preview: z.string().nullable().optional(),
  folderId: z.string().trim().min(1).nullable().optional(),
});

const createShareSchema = z.object({
  permission: z.enum(['view', 'edit']).default('view'),
  expiresAt: z.coerce.date().optional(),
  expiresInHours: z
    .number()
    .int()
    .positive()
    .max(24 * 365)
    .optional(),
});

const filesRouter: Router = Router();

export function nanoidLike(size = 21): string {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz-';
  const bytes = randomBytes(size);
  let token = '';
  for (let i = 0; i < size; i += 1) {
    token += alphabet[bytes[i]! & 63]!;
  }
  return token;
}

filesRouter.get('/', async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const parsedQuery = listFilesQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({
      error: 'Invalid file query parameters',
      details: parsedQuery.error.flatten(),
    });
    return;
  }

  const { search, folderId, page, limit, cursor } = parsedQuery.data;

  try {
    const result = await FileService.listFiles({
      userId: req.userId,
      search,
      folderId,
      limit,
      cursor,
    });

    const responseHash = createHash('md5')
      .update(JSON.stringify({ files: result.files, total: result.isCursorBased ? undefined : result.total }))
      .digest('hex');
    const etag = `"${responseHash}"`;

    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    res.set('Cache-Control', 'private, max-age=0, must-revalidate');
    res.set('ETag', etag);
    res.json({
      files: result.files,
      total: result.isCursorBased ? undefined : result.total,
      page: result.isCursorBased ? undefined : page,
      limit,
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'list_files_error',
        error: error instanceof Error ? error.message : String(error),
      })
    );
    res.status(500).json({ error: 'Failed to list files' });
  }
});

filesRouter.post('/', async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const parsedBody = createFileSchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({
      error: 'Invalid create file payload',
      details: parsedBody.error.flatten(),
    });
    return;
  }

  const payload = parsedBody.data;

  try {
    const result = await FileService.createFile({
      userId: req.userId,
      name: payload.name,
      folderId: payload.folderId,
      content: payload.content,
      preview: payload.preview,
    });

    if (result && 'error' in result) {
      const errorMsg = result.error as string;
      res.status(errorMsg.includes('limit') ? 403 : 404).json({ error: errorMsg });
      return;
    }

    res.status(201).json(result.file);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'create_file_error',
        error: error instanceof Error ? error.message : String(error),
      })
    );
    res.status(500).json({ error: 'Failed to create file' });
  }
});

filesRouter.get('/:id', async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const id = typeof req.params.id === 'string' ? req.params.id : null;
  if (!id) {
    res.status(400).json({ error: 'File id is required' });
    return;
  }

  try {
    const file = await FileService.getFile(req.userId, id);

    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    res.json({ file });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'get_file_error',
        error: error instanceof Error ? error.message : String(error),
      })
    );
    res.status(500).json({ error: 'Failed to load file' });
  }
});

filesRouter.patch('/:id', async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const id = typeof req.params.id === 'string' ? req.params.id : null;
  if (!id) {
    res.status(400).json({ error: 'File id is required' });
    return;
  }

  const parsedBody = patchFileSchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({
      error: 'Invalid update file payload',
      details: parsedBody.error.flatten(),
    });
    return;
  }

  const payload = parsedBody.data;

  try {
    const result = await FileService.updateFile({
      userId: req.userId,
      fileId: id,
      name: payload.name,
      content: payload.content,
      preview: payload.preview,
      folderId: payload.folderId,
    });

    if (!result) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    if ('error' in result) {
      res.status(404).json({ error: result.error });
      return;
    }

    res.json({ file: result.file });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'update_file_error',
        error: error instanceof Error ? error.message : String(error),
      })
    );
    res.status(500).json({ error: 'Failed to update file' });
  }
});

filesRouter.delete('/:id', async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const id = typeof req.params.id === 'string' ? req.params.id : null;
  if (!id) {
    res.status(400).json({ error: 'File id is required' });
    return;
  }

  try {
    const deleted = await FileService.deleteFile(req.userId, id);

    if (!deleted) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    res.status(204).send();
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'delete_file_error',
        error: error instanceof Error ? error.message : String(error),
      })
    );
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

filesRouter.post('/:id/share', async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const id = typeof req.params.id === 'string' ? req.params.id : null;
  if (!id) {
    res.status(400).json({ error: 'File id is required' });
    return;
  }

  const parsedBody = createShareSchema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    res.status(400).json({
      error: 'Invalid share payload',
      details: parsedBody.error.flatten(),
    });
    return;
  }

  try {
    const result = await FileService.createShare({
      userId: req.userId,
      fileId: id,
      permission: parsedBody.data.permission,
      expiresAt: parsedBody.data.expiresAt,
      expiresInHours: parsedBody.data.expiresInHours,
    });

    if (!result) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    res.status(201).json({
      token: result.token,
      permission: result.permission,
      expiresAt: result.expiresAt,
      shareUrl: result.shareUrl,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'share_file_error',
        error: error instanceof Error ? error.message : String(error),
      })
    );
    res.status(500).json({ error: 'Failed to create share link' });
  }
});

filesRouter.delete('/:id/share', async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const id = typeof req.params.id === 'string' ? req.params.id : null;
  if (!id) {
    res.status(400).json({ error: 'File id is required' });
    return;
  }

  try {
    const revoked = await FileService.revokeShare(req.userId, id);

    if (!revoked) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    res.status(204).send();
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'revoke_share_error',
        error: error instanceof Error ? error.message : String(error),
      })
    );
    res.status(500).json({ error: 'Failed to revoke share link' });
  }
});

export { filesRouter };
