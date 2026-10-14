import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { db } from '@dripl/db';
import { issueWsTicket, type WsTicketPrincipal } from './auth';
import { ShareService, type SharePermission } from '../services/shareService';
import { authMiddleware } from '../middlewares/authMiddleware';
import { defineRoute } from '../lib/route';
import { sendError } from '../lib/response';
import { createRateLimiter } from '../lib/rateLimiter';

const shareRouter: Router = Router();

const shareRateLimit = createRateLimiter({
  limit: 30,
  windowMs: 15 * 60 * 1000,
  prefix: 'dripl:http:share',
});

async function shareLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  const identifier = req.ip ?? 'anonymous';
  const { success, resetAt } = await shareRateLimit.limit(identifier);
  if (!success) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))));
    sendError(res, 429, 'RATE_LIMITED', 'Too many requests, please try again later.');
    return;
  }
  next();
}

const createShareBodySchema = z.object({
  fileId: z.string().min(1).max(100),
  permission: z.enum(['view', 'edit']),
});

shareRouter.post(
  '/',
  authMiddleware,
  shareLimiter,
  defineRoute({
    auth: 'required',
    // Parsed manually inside the handler rather than via `body:` so the 400
    // keeps its historical no-`details` envelope (`sendError`, not the
    // zod-flatten shape `defineRoute` validation would answer).
    errors: {
      not_found: 'File not found',
      forbidden: 'You do not have permission to share this file',
    },
    event: 'create_share_error',
    internalError: 'Failed to create share link',
    handler: async ({ userId, req, res }) => {
      const parsed = createShareBodySchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(res, 400, 'INVALID_PAYLOAD', 'fileId and permission are required');
        return;
      }

      const result = await ShareService.upsertShareToken(
        parsed.data.fileId,
        userId,
        parsed.data.permission as SharePermission
      );

      if (result.kind !== 'ok') return result;

      res.status(200).json({ token: result.token });
      return result;
    },
  })
);

shareRouter.get('/:token/ws-ticket', shareLimiter, async (req, res) => {
  // Intentionally NOT on defineRoute: `appErrorClassification.test.ts` and
  // `appComposition.test.ts` drive this route with a rejecting
  // `db.file.findUnique` to prove a thrown route error reaches the terminal
  // handler (`http_server_error`, stack attached). defineRoute would catch the
  // throw itself and answer the same 500 with a route event instead, moving
  // the fault from the server branch to a route log line.
  res.set('Cache-Control', 'no-store');
  const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;
  if (!token) {
    sendError(res, 400, 'INVALID_PAYLOAD', 'Share token is required');
    return;
  }
  // Length guard before the DB: issued tokens are ~32 chars, so an overlong
  // value is hostile. Answers the same 404 a miss gets — wire-identical.
  if (token.length > 512) {
    sendError(res, 404, 'NOT_FOUND', 'Share link not found');
    return;
  }

  const file = await db.file.findUnique({
    where: { shareToken: token },
    select: { id: true, sharePermission: true, shareExpiresAt: true },
  });
  if (!file || !file.sharePermission) {
    sendError(res, 404, 'NOT_FOUND', 'Share link not found');
    return;
  }
  if (file.shareExpiresAt && file.shareExpiresAt.getTime() < Date.now()) {
    sendError(res, 410, 'EXPIRED', 'Share link has expired');
    return;
  }

  const permission: SharePermission = file.sharePermission === 'edit' ? 'edit' : 'view';
  const principal: WsTicketPrincipal = {
    kind: 'share',
    fileId: file.id,
    token,
    permission,
  };
  res.json({ ticket: issueWsTicket(principal), fileId: file.id, permission });
});

shareRouter.get(
  '/:token',
  shareLimiter,
  defineRoute({
    auth: 'none',
    event: 'get_share_error',
    internalError: 'Failed to load shared file',
    handler: async ({ req, res }) => {
      res.set('Cache-Control', 'no-store');
      const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;
      if (!token) {
        sendError(res, 400, 'INVALID_PAYLOAD', 'Share token is required');
        return;
      }
      // Same length guard as the ws-ticket bridge above: same 404 as a miss.
      if (token.length > 512) {
        sendError(res, 404, 'NOT_FOUND', 'Share link not found');
        return;
      }

      const result = await ShareService.resolveShare(token);

      if (!result) {
        sendError(res, 404, 'NOT_FOUND', 'Share link not found');
        return;
      }

      if (result.expired) {
        sendError(res, 410, 'EXPIRED', 'Share link has expired');
        return;
      }

      res.json({
        file: result.file,
        permission: result.permission,
        encryptedPayload: result.encryptedPayload,
        elements: result.elements,
      });
    },
  })
);

export { shareRouter };
