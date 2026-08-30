import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { ShareService, type SharePermission } from '../services/shareService';
import { sendError } from '../lib/response';
import { logger } from '../logger.js';

const shareRouter: Router = Router();

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const shareRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, '15 m'),
  prefix: 'dripl:http:share',
});

async function shareLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  const identifier = req.ip ?? 'anonymous';
  const { success } = await shareRateLimit.limit(identifier);
  if (!success) {
    sendError(res, 429, 'RATE_LIMITED', 'Too many requests, please try again later.');
    return;
  }
  next();
}

const createShareBodySchema = z.object({
  fileId: z.string().min(1).max(100),
  permission: z.enum(['view', 'edit']),
});

shareRouter.post('/', shareLimiter, async (req, res) => {
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

    if (result.kind === 'not_found') {
      sendError(res, 404, 'NOT_FOUND', 'File not found');
      return;
    }
    if (result.kind === 'forbidden') {
      sendError(res, 403, 'FORBIDDEN', 'You do not have permission to share this file');
      return;
    }

    res.status(200).json({ token: result.token });
  } catch (error) {
    logger.error({ event: 'create_share_error', error }, 'Failed to create share link');
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to create share link');
  }
});

shareRouter.get('/:token', shareLimiter, async (req, res) => {
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
