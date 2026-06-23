import { Router, type Request, type Response, type NextFunction } from 'express';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { ShareService } from '../services/shareService';
import { sendError } from '../lib/response';

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
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'get_share_error',
        error: error instanceof Error ? error.message : String(error),
      })
    );
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to load shared file');
  }
});

export { shareRouter };
