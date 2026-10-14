import { createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { sendError } from '../lib/response';
import { defineRoute } from '../lib/route';
import { sendServiceError } from '../lib/serviceResult';
import { FileService } from '../services/fileService';
import { MAX_FILE_CONTENT_BYTES } from '@dripl/common';

const listFilesQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  folderId: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().max(200).optional(),
});

const createFileSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  folderId: z.string().trim().min(1).max(100).nullable().optional(),
  content: z.unknown().optional(),
  preview: z.string().max(2_000_000).nullable().optional(),
});

const patchFileSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  content: z.unknown().optional(),
  preview: z.string().max(2_000_000).nullable().optional(),
  folderId: z.string().trim().min(1).max(100).nullable().optional(),
  expectedUpdatedAt: z.coerce.date().optional(),
});

const createShareSchema = z.object({
  permission: z.enum(['view', 'edit']).default('view'),
  expiresAt: z.coerce
    .date()
    .refine(value => value.getTime() > Date.now(), 'Expiry must be in the future')
    .optional(),
  expiresInHours: z
    .number()
    .int()
    .positive()
    .max(24 * 365)
    .optional(),
});

const listSharedFilesQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().max(200).optional(),
});

const filesRouter: Router = Router();

filesRouter.get(
  '/',
  defineRoute({
    auth: 'required',
    query: listFilesQuerySchema,
    invalidQuery: { message: 'Invalid file query parameters' },
    event: 'list_files_error',
    internalError: 'Failed to list files',
    handler: async ({ userId, query, req, res }) => {
      const { search, folderId, page, limit, cursor } = query;

      const result = await FileService.listFiles({
        userId,
        search,
        folderId,
        limit,
        page,
        cursor,
      });

      // Stable pagination shape: `total` and `page` are always populated —
      // `cursor` is the primary forward-paging mechanism and `total`/`page`
      // are informational passthrough for the existing offset UI. (A previous
      // revision stripped them in cursor mode, so the same endpoint answered
      // two shapes; that is what this pins against.)
      const stableBody = {
        files: result.files,
        total: result.total,
        page,
        limit,
        nextCursor: result.nextCursor,
      };

      const responseHash = createHash('md5').update(JSON.stringify(stableBody)).digest('hex');
      const etag = `"${responseHash}"`;

      if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }

      res.set('Cache-Control', 'private, max-age=0, must-revalidate');
      res.set('ETag', etag);
      res.json(stableBody);
    },
  })
);

filesRouter.get(
  '/shared',
  defineRoute({
    auth: 'required',
    query: listSharedFilesQuerySchema,
    invalidQuery: { message: 'Invalid query parameters' },
    event: 'list_shared_files_error',
    internalError: 'Failed to list shared files',
    handler: async ({ userId, query, res }) => {
      const { search, page, limit, cursor } = query;

      const result = await FileService.listSharedFiles({
        userId,
        search,
        limit,
        page,
        cursor,
      });

      // Same stable-shape rule as `GET /` above: `total`/`page` always
      // populated, `nextCursor` null when the page is not full.
      res.json({
        files: result.files,
        total: result.total,
        page,
        limit,
        nextCursor: result.nextCursor,
      });
    },
  })
);

filesRouter.post(
  '/',
  defineRoute({
    auth: 'required',
    body: createFileSchema,
    invalidBody: { message: 'Invalid create file payload' },
    errors: {
      folder_not_found: 'Folder not found',
      invalid_scene: 'Invalid scene content',
    },
    event: 'create_file_error',
    internalError: 'Failed to create file',
    handler: async ({ userId, body, res }) => {
      const payload = body;

      // Serialized once: the string both measures the payload (413 guard
      // below) and travels to the service, which validates and stores from
      // it directly instead of re-serializing. Same bytes measured and
      // stored, so the guard cannot disagree with what is written.
      const contentString =
        payload.content !== undefined ? JSON.stringify(payload.content) : undefined;

      if (contentString !== undefined) {
        const contentSize = Buffer.byteLength(contentString, 'utf8');
        if (contentSize > MAX_FILE_CONTENT_BYTES) {
          sendError(
            res,
            413,
            'PAYLOAD_TOO_LARGE',
            `File content too large (${contentSize} bytes, max ${MAX_FILE_CONTENT_BYTES})`
          );
          return;
        }
      }

      const result = await FileService.createFile({
        userId,
        name: payload.name,
        folderId: payload.folderId,
        content: contentString ?? payload.content,
        preview: payload.preview,
      });

      if (result && 'kind' in result && result.kind === 'quota_exceeded') {
        // The quota message embeds the live limit from the service result —
        // the only kind carrying a payload. Handled inline because the
        // `errors` map is static; the remaining kinds delegate to it below.
        sendServiceError(res, result, {
          quota_exceeded: `Free plan limit reached (${result.limit} canvases). Delete one or upgrade to Premium.`,
        });
        return;
      }
      if (result && 'kind' in result) return result;

      res.status(201).json(result.file);
      return result;
    },
  })
);

filesRouter.get(
  '/:id',
  defineRoute({
    auth: 'required',
    event: 'get_file_error',
    internalError: 'Failed to load file',
    handler: async ({ userId, req, res }) => {
      const id = typeof req.params.id === 'string' ? req.params.id : null;
      if (!id) {
        sendError(res, 400, 'FILE_ID_REQUIRED', 'File id is required');
        return;
      }

      const file = await FileService.getFile(userId, id);

      if (!file) {
        sendError(res, 404, 'NOT_FOUND', 'File not found');
        return;
      }

      res.json({ file });
    },
  })
);

filesRouter.patch(
  '/:id',
  defineRoute({
    auth: 'required',
    body: patchFileSchema,
    invalidBody: { message: 'Invalid update file payload' },
    errors: {
      folder_not_found: 'Folder not found',
      invalid_scene: 'Invalid scene content',
      conflict: 'File changed while saving',
    },
    event: 'update_file_error',
    internalError: 'Failed to update file',
    handler: async ({ userId, body, req, res }) => {
      const id = typeof req.params.id === 'string' ? req.params.id : null;
      if (!id) {
        sendError(res, 400, 'FILE_ID_REQUIRED', 'File id is required');
        return;
      }

      const payload = body;

      // Serialized once (see POST / above): the same string feeds the 413
      // guard and the service, which validates and stores from it directly.
      const contentString =
        payload.content !== undefined ? JSON.stringify(payload.content) : undefined;

      if (contentString !== undefined) {
        const contentSize = Buffer.byteLength(contentString, 'utf8');
        if (contentSize > MAX_FILE_CONTENT_BYTES) {
          sendError(
            res,
            413,
            'PAYLOAD_TOO_LARGE',
            `File content too large (${contentSize} bytes, max ${MAX_FILE_CONTENT_BYTES})`
          );
          return;
        }
      }

      const result = await FileService.updateFile({
        userId,
        fileId: id,
        name: payload.name,
        content: contentString ?? payload.content,
        preview: payload.preview,
        folderId: payload.folderId,
        expectedUpdatedAt: payload.expectedUpdatedAt,
      });

      if (!result) {
        sendError(res, 404, 'NOT_FOUND', 'File not found');
        return;
      }

      if ('kind' in result) return result;

      res.json({ file: result.file });
      return result;
    },
  })
);

filesRouter.delete(
  '/:id',
  defineRoute({
    auth: 'required',
    event: 'delete_file_error',
    internalError: 'Failed to delete file',
    handler: async ({ userId, req, res }) => {
      const id = typeof req.params.id === 'string' ? req.params.id : null;
      if (!id) {
        sendError(res, 400, 'FILE_ID_REQUIRED', 'File id is required');
        return;
      }

      const deleted = await FileService.deleteFile(userId, id);

      if (!deleted) {
        sendError(res, 404, 'NOT_FOUND', 'File not found');
        return;
      }

      res.status(204).send();
    },
  })
);

filesRouter.post(
  '/:id/share',
  defineRoute({
    auth: 'required',
    // Parsed manually inside the handler (`req.body ?? {}`) rather than via
    // `body:` so an absent JSON body keeps its historical 201-with-defaults
    // instead of a 400. The 400 below replicates the invalidBody envelope.
    errors: {
      invalid_scene: 'Invalid scene content',
      conflict: 'Share changed while creating; retry',
    },
    event: 'share_file_error',
    internalError: 'Failed to create share link',
    handler: async ({ userId, req, res }) => {
      const id = typeof req.params.id === 'string' ? req.params.id : null;
      if (!id) {
        sendError(res, 400, 'FILE_ID_REQUIRED', 'File id is required');
        return;
      }

      const parsedBody = createShareSchema.safeParse(req.body ?? {});
      if (!parsedBody.success) {
        res.status(400).json({
          error: 'INVALID_PAYLOAD',
          message: 'Invalid share payload',
          statusCode: 400,
          details: parsedBody.error.flatten(),
        });
        return;
      }

      const result = await FileService.createShare({
        userId,
        fileId: id,
        permission: parsedBody.data.permission,
        expiresAt: parsedBody.data.expiresAt,
        expiresInHours: parsedBody.data.expiresInHours,
      });

      if (!result) {
        sendError(res, 404, 'NOT_FOUND', 'File not found');
        return;
      }
      if ('kind' in result) return result;

      res.status(201).json({
        token: result.token,
        permission: result.permission,
        expiresAt: result.expiresAt,
        shareUrl: result.shareUrl,
      });
      return result;
    },
  })
);

filesRouter.delete(
  '/:id/share',
  defineRoute({
    auth: 'required',
    event: 'revoke_share_error',
    internalError: 'Failed to revoke share link',
    handler: async ({ userId, req, res }) => {
      const id = typeof req.params.id === 'string' ? req.params.id : null;
      if (!id) {
        sendError(res, 400, 'FILE_ID_REQUIRED', 'File id is required');
        return;
      }

      const revoked = await FileService.revokeShare(userId, id);

      if (!revoked) {
        sendError(res, 404, 'NOT_FOUND', 'File not found');
        return;
      }

      res.status(204).send();
    },
  })
);

export { filesRouter };
