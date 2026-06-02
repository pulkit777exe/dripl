import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ShareService } from '../services/shareService';

const shareRouter: Router = Router();

const shareLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

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
