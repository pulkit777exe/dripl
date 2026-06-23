import { Router, type Request, type Response, type NextFunction } from 'express';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { ShareService } from '../services/shareService';

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
    res.status(429).json({ error: 'Too many requests, please try again later.' });
    return;
  }
  next();
}

shareRouter.get('/:token', shareLimiter, async (req, res) => {
  const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;
  if (!token) {
    res.status(400).json({ error: 'Share token is required' });
    return;
  }

  try {
    const result = await ShareService.resolveShare(token);

    if (!result) {
      res.status(404).json({ error: 'Share link not found' });
      return;
    }

    if (result.expired) {
      res.status(410).json({ error: 'Share link has expired' });
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
    res.status(500).json({ error: 'Failed to load shared file' });
  }
});

export { shareRouter };
