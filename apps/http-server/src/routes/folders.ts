import { Router } from 'express';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { sendError } from '../lib/response';
import { sendServiceError } from '../lib/serviceResult';
import { logger } from '../logger';
import { FolderService } from '../services/folderService';

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

foldersRouter.get('/', async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }

  try {
    const folders = await FolderService.listFolders(req.userId);
    res.json({ folders });
  } catch (error) {
    logger.error({ event: 'list_folders_error', error }, 'Failed to list folders');
    res.status(500).json({
      error: 'Failed to list folders',
      message: 'Failed to list folders',
      statusCode: 500,
    });
  }
});

foldersRouter.post('/', async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }

  const parsedBody = createFolderSchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({
      error: 'Invalid create folder payload',
      details: parsedBody.error.flatten(),
      message: 'Invalid create folder payload',
      statusCode: 400,
    });
    return;
  }

  try {
    const result = await FolderService.createFolder({
      userId: req.userId,
      name: parsedBody.data.name,
      parentId: parsedBody.data.parentId ?? null,
    });
    if (result.kind !== 'ok') {
      sendServiceError(res, result, {
        parent_not_found: 'Parent folder not found',
      });
      return;
    }

    res.status(201).json({ folder: result.folder });
  } catch (error) {
    logger.error({ event: 'create_folder_error', error }, 'Failed to create folder');
    res.status(500).json({
      error: 'Failed to create folder',
      message: 'Failed to create folder',
      statusCode: 500,
    });
  }
});

foldersRouter.patch('/:id', async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }

  const id = getSingleParam(req.params.id);
  if (!id) {
    sendError(res, 400, 'FOLDER_ID_REQUIRED', 'Folder id is required');
    return;
  }

  const parsedBody = patchFolderSchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({
      error: 'Invalid update folder payload',
      details: parsedBody.error.flatten(),
      message: 'Invalid update folder payload',
      statusCode: 400,
    });
    return;
  }

  try {
    const result = await FolderService.updateFolder({
      userId: req.userId,
      id,
      name: parsedBody.data.name,
      parentId: parsedBody.data.parentId,
    });
    if (result.kind !== 'ok') {
      sendServiceError(res, result, {
        not_found: 'Folder not found',
        self_parent: 'Folder cannot be its own parent',
        parent_not_found: 'Parent folder not found',
        cycle: 'Folder hierarchy cannot contain a cycle',
      });
      return;
    }

    res.json({ folder: result.folder });
  } catch (error) {
    logger.error({ event: 'update_folder_error', error }, 'Failed to update folder');
    res.status(500).json({
      error: 'Failed to update folder',
      message: 'Failed to update folder',
      statusCode: 500,
    });
  }
});

foldersRouter.delete('/:id', async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }

  const id = getSingleParam(req.params.id);
  if (!id) {
    sendError(res, 400, 'FOLDER_ID_REQUIRED', 'Folder id is required');
    return;
  }

  try {
    const result = await FolderService.deleteFolderCascade(req.userId, id);
    if (result.kind !== 'ok') {
      sendServiceError(res, result, {
        not_found: 'Folder not found',
        too_deep: 'Folder hierarchy is too deep to delete safely',
      });
      return;
    }

    res.status(204).send();
  } catch (error) {
    logger.error({ event: 'delete_folder_error', error }, 'Failed to delete folder');
    res.status(500).json({
      error: 'Failed to delete folder',
      message: 'Failed to delete folder',
      statusCode: 500,
    });
  }
});

export { foldersRouter };
