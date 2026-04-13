import { Router } from 'express';
import { z } from 'zod';
import { db } from '@dripl/db';
import type { AuthenticatedRequest } from '../middleware/auth';

const createFolderSchema = z.object({
  name: z.string().trim().min(1).max(200),
  parentId: z.string().trim().min(1).nullable().optional(),
});

const patchFolderSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  parentId: z.string().trim().min(1).nullable().optional(),
});

const foldersRouter: Router = Router();

function getSingleParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return typeof value === 'string' ? value : null;
}

async function assertParentFolder(
  userId: string,
  parentId: string | null | undefined
): Promise<boolean> {
  if (!parentId) return true;
  const parent = await db.folder.findFirst({
    where: { id: parentId, userId },
    select: { id: true },
  });
  return Boolean(parent);
}

foldersRouter.get('/', async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const folders = await db.folder.findMany({
      where: { userId: req.userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: {
          select: {
            files: true,
          },
        },
      },
    });

    res.json({
      folders: folders.map(folder => ({
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId,
        fileCount: folder._count.files,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
      })),
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'list_folders_error',
        error: error instanceof Error ? error.message : String(error),
      })
    );
    res.status(500).json({ error: 'Failed to list folders' });
  }
});

foldersRouter.post('/', async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const parsedBody = createFolderSchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({
      error: 'Invalid create folder payload',
      details: parsedBody.error.flatten(),
    });
    return;
  }

  try {
    const parentId = parsedBody.data.parentId ?? null;
    const hasParent = await assertParentFolder(req.userId, parentId);
    if (!hasParent) {
      res.status(404).json({ error: 'Parent folder not found' });
      return;
    }

    const folder = await db.folder.create({
      data: {
        name: parsedBody.data.name,
        parentId,
        userId: req.userId,
      },
      select: {
        id: true,
        name: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.status(201).json({ folder });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'create_folder_error',
        error: error instanceof Error ? error.message : String(error),
      })
    );
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

foldersRouter.patch('/:id', async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const id = getSingleParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: 'Folder id is required' });
    return;
  }

  const parsedBody = patchFolderSchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({
      error: 'Invalid update folder payload',
      details: parsedBody.error.flatten(),
    });
    return;
  }

  try {
    const existing = await db.folder.findFirst({
      where: { id, userId: req.userId },
      select: { id: true },
    });
    if (!existing) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }

    const parentId = parsedBody.data.parentId;
    if (parentId === id) {
      res.status(400).json({ error: 'Folder cannot be its own parent' });
      return;
    }
    if (parentId !== undefined) {
      const hasParent = await assertParentFolder(req.userId, parentId ?? null);
      if (!hasParent) {
        res.status(404).json({ error: 'Parent folder not found' });
        return;
      }
    }

    const updated = await db.folder.update({
      where: { id },
      data: {
        name: parsedBody.data.name,
        parentId: parsedBody.data.parentId,
      },
      select: {
        id: true,
        name: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({ folder: updated });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'update_folder_error',
        error: error instanceof Error ? error.message : String(error),
      })
    );
    res.status(500).json({ error: 'Failed to update folder' });
  }
});

foldersRouter.delete('/:id', async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const id = getSingleParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: 'Folder id is required' });
    return;
  }

  try {
    const root = await db.folder.findFirst({
      where: { id, userId: req.userId },
      select: { id: true },
    });
    if (!root) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }

    const toDelete = new Set<string>([id]);
    let frontier = [id];

    while (frontier.length > 0) {
      const children = await db.folder.findMany({
        where: {
          parentId: { in: frontier },
          userId: req.userId,
        },
        select: { id: true },
      });
      frontier = children.map(child => child.id);
      for (const folder of children) {
        toDelete.add(folder.id);
      }
    }

    const folderIds = Array.from(toDelete);

    await db.file.deleteMany({
      where: {
        userId: req.userId,
        folderId: { in: folderIds },
      },
    });

    await db.folder.deleteMany({
      where: {
        userId: req.userId,
        id: { in: folderIds },
      },
    });

    res.status(204).send();
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'delete_folder_error',
        error: error instanceof Error ? error.message : String(error),
      })
    );
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

export { foldersRouter };
