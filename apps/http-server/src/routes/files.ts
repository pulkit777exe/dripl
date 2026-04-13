import { randomBytes } from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '@dripl/db';
import type { AuthenticatedRequest } from '../middleware/auth';
import {
  buildEncryptedShare,
  parseStoredFileContent,
  serializeStoredFileContent,
} from '../lib/encrypt';

const listFilesQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  folderId: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
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

function getSingleParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return typeof value === 'string' ? value : null;
}

function nanoidLike(size = 21): string {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz-';
  const bytes = randomBytes(size);
  let token = '';
  for (let i = 0; i < size; i += 1) {
    token += alphabet[bytes[i]! & 63]!;
  }
  return token;
}

async function ensureFolderOwnership(
  userId: string,
  folderId: string | null | undefined
): Promise<boolean> {
  if (!folderId) return true;
  const folder = await db.folder.findFirst({
    where: { id: folderId, userId },
    select: { id: true },
  });
  return Boolean(folder);
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

  const { search, folderId, page, limit } = parsedQuery.data;
  const skip = (page - 1) * limit;

  try {
    const [files, total] = await Promise.all([
      db.file.findMany({
        where: {
          userId: req.userId,
          ...(typeof folderId === 'string' ? { folderId } : {}),
          ...(typeof search === 'string'
            ? {
                name: {
                  contains: search,
                  mode: 'insensitive',
                },
              }
            : {}),
        },
        orderBy: {
          updatedAt: 'desc',
        },
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          preview: true,
          folderId: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      db.file.count({
        where: {
          userId: req.userId,
          ...(typeof folderId === 'string' ? { folderId } : {}),
          ...(typeof search === 'string'
            ? {
                name: {
                  contains: search,
                  mode: 'insensitive',
                },
              }
            : {}),
        },
      }),
    ]);

    res.json({ files, total, page, limit });
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
    const folderId = payload.folderId ?? null;
    const hasFolderAccess = await ensureFolderOwnership(req.userId, folderId);
    if (!hasFolderAccess) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }

    const contentRecord = parseStoredFileContent(
      JSON.stringify(payload.content !== undefined ? payload.content : [])
    );

    const file = await db.file.create({
      data: {
        name: payload.name ?? 'Untitled file',
        userId: req.userId,
        folderId,
        preview: payload.preview ?? null,
        content: serializeStoredFileContent(contentRecord),
      },
      select: {
        id: true,
        name: true,
      },
    });

    res.status(201).json(file);
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

  const id = getSingleParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: 'File id is required' });
    return;
  }

  try {
    const file = await db.file.findFirst({
      where: { id, userId: req.userId },
    });

    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const parsedContent = parseStoredFileContent(file.content);

    res.json({
      file: {
        id: file.id,
        name: file.name,
        preview: file.preview,
        folderId: file.folderId,
        content: parsedContent.elements,
        encryptedPayload: parsedContent.encryptedPayload,
        shareToken: file.shareToken,
        sharePermission: file.sharePermission,
        shareExpiresAt: file.shareExpiresAt,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
      },
    });
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

  const id = getSingleParam(req.params.id);
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
    const existing = await db.file.findFirst({
      where: { id, userId: req.userId },
    });

    if (!existing) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const folderId = payload.folderId ?? existing.folderId;
    const hasFolderAccess = await ensureFolderOwnership(req.userId, folderId);
    if (!hasFolderAccess) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }

    const existingContent = parseStoredFileContent(existing.content);
    const nextContent =
      payload.content !== undefined
        ? parseStoredFileContent(JSON.stringify(payload.content))
        : existingContent;

    const updated = await db.file.update({
      where: { id: existing.id },
      data: {
        name: payload.name,
        preview: payload.preview,
        folderId,
        content:
          payload.content !== undefined
            ? serializeStoredFileContent({
                elements: nextContent.elements,
                encryptedPayload: null,
                encryptedAt: null,
              })
            : undefined,
      },
      select: {
        id: true,
        name: true,
        preview: true,
        folderId: true,
        updatedAt: true,
      },
    });

    res.json({ file: updated });
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

  const id = getSingleParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: 'File id is required' });
    return;
  }

  try {
    const file = await db.file.findFirst({
      where: { id, userId: req.userId },
      select: { id: true },
    });

    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    await db.file.delete({
      where: { id: file.id },
    });

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

  const id = getSingleParam(req.params.id);
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
    const file = await db.file.findFirst({
      where: { id, userId: req.userId },
    });

    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const token = nanoidLike(24);
    const baseUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    const baseShareUrl = `${baseUrl}/share/${token}`;
    const parsedContent = parseStoredFileContent(file.content);
    const { shareUrl, encryptedPayload } = await buildEncryptedShare(
      baseShareUrl,
      parsedContent.elements
    );
    const expiresAt =
      parsedBody.data.expiresAt ??
      (parsedBody.data.expiresInHours
        ? new Date(Date.now() + parsedBody.data.expiresInHours * 60 * 60 * 1000)
        : null);

    await db.file.update({
      where: { id: file.id },
      data: {
        shareToken: token,
        sharePermission: parsedBody.data.permission,
        shareExpiresAt: expiresAt,
        content: serializeStoredFileContent({
          elements: parsedContent.elements,
          encryptedPayload,
          encryptedAt: new Date().toISOString(),
        }),
      },
    });

    res.status(201).json({
      token,
      permission: parsedBody.data.permission,
      expiresAt,
      shareUrl,
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

  const id = getSingleParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: 'File id is required' });
    return;
  }

  try {
    const file = await db.file.findFirst({
      where: { id, userId: req.userId },
    });

    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    await db.file.update({
      where: { id: file.id },
      data: {
        shareToken: null,
        sharePermission: null,
        shareExpiresAt: null,
      },
    });

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
