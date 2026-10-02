import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { db } from '@dripl/db';
import { issueWsTicket, type WsTicketPrincipal } from './auth';
import { ShareService, type SharePermission } from '../services/shareService';
import { authMiddleware } from '../middlewares/authMiddleware';
import { sendError } from '../lib/response';
import { sendServiceError } from '../lib/serviceResult';
import { createRateLimiter } from '../lib/rateLimiter';
import { logger } from '../logger';

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

shareRouter.post('/', authMiddleware, shareLimiter, async (req, res) => {
  const userId = (req as { userId?: string }).userId;
  if (!userId) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }

  const parsed = createShareBodySchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'INVALID_PAYLOAD', 'fileId and permission are required');
    return;
  }

  try {
    const result = await ShareService.upsertShareToken(
      parsed.data.fileId,
      userId,
      parsed.data.permission as SharePermission
    );

    if (result.kind !== 'ok') {
      sendServiceError(res, result, {
        not_found: 'File not found',
        forbidden: 'You do not have permission to share this file',
      });
      return;
    }

    res.status(200).json({ token: result.token });
  } catch (error) {
    logger.error({ event: 'create_share_error', error }, 'Failed to create share link');
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to create share link');
  }
});

shareRouter.get('/:token/ws-ticket', shareLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;
  if (!token) {
    sendError(res, 400, 'INVALID_PAYLOAD', 'Share token is required');
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

shareRouter.get('/:token', shareLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;
  if (!token) {
    sendError(res, 400, 'INVALID_PAYLOAD', 'Share token is required');
    return;
  }

  try {
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
  } catch (error) {
    logger.error({ event: 'get_share_error', error }, 'Failed to load shared file');
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to load shared file');
  }
});

export { shareRouter };
