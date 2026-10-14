import { Router } from 'express';
import { z } from 'zod';
import { sendError } from '../lib/response';
import { defineRoute } from '../lib/route';
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

foldersRouter.get(
  '/',
  defineRoute({
    auth: 'required',
    event: 'list_folders_error',
    internalError: { code: 'Failed to list folders', message: 'Failed to list folders' },
    handler: async ({ userId, res }) => {
      const folders = await FolderService.listFolders(userId);
      res.json({ folders });
    },
  })
);

foldersRouter.post(
  '/',
  defineRoute({
    auth: 'required',
    body: createFolderSchema,
    invalidBody: { code: 'Invalid create folder payload', message: 'Invalid create folder payload' },
    errors: {
      parent_not_found: 'Parent folder not found',
    },
    event: 'create_folder_error',
    internalError: { code: 'Failed to create folder', message: 'Failed to create folder' },
    handler: async ({ userId, body, res }) => {
      const result = await FolderService.createFolder({
        userId,
        name: body.name,
        parentId: body.parentId ?? null,
      });
      if (result.kind !== 'ok') return result;
      res.status(201).json({ folder: result.folder });
      return result;
    },
  })
);

foldersRouter.patch(
  '/:id',
  defineRoute({
    auth: 'required',
    body: patchFolderSchema,
    invalidBody: { code: 'Invalid update folder payload', message: 'Invalid update folder payload' },
    errors: {
      not_found: 'Folder not found',
      self_parent: 'Folder cannot be its own parent',
      parent_not_found: 'Parent folder not found',
      cycle: 'Folder hierarchy cannot contain a cycle',
    },
    event: 'update_folder_error',
    internalError: { code: 'Failed to update folder', message: 'Failed to update folder' },
    handler: async ({ userId, body, req, res }) => {
      const id = getSingleParam(req.params.id);
      if (!id) {
        sendError(res, 400, 'FOLDER_ID_REQUIRED', 'Folder id is required');
        return;
      }

      const result = await FolderService.updateFolder({
        userId,
        id,
        name: body.name,
        parentId: body.parentId,
      });
      if (result.kind !== 'ok') return result;
      res.json({ folder: result.folder });
      return result;
    },
  })
);

foldersRouter.delete(
  '/:id',
  defineRoute({
    auth: 'required',
    errors: {
      not_found: 'Folder not found',
      too_deep: 'Folder hierarchy is too deep to delete safely',
    },
    event: 'delete_folder_error',
    internalError: { code: 'Failed to delete folder', message: 'Failed to delete folder' },
    handler: async ({ userId, req, res }) => {
      const id = getSingleParam(req.params.id);
      if (!id) {
        sendError(res, 400, 'FOLDER_ID_REQUIRED', 'Folder id is required');
        return;
      }

      const result = await FolderService.deleteFolderCascade(userId, id);
      if (result.kind !== 'ok') return result;
      res.status(204).send();
      return result;
    },
  })
);

export { foldersRouter };
