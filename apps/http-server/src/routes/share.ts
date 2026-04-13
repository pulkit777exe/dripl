import { Router } from 'express';
import { db } from '@dripl/db';
import { parseStoredFileContent } from '../lib/encrypt';

const shareRouter: Router = Router();

shareRouter.get('/:token', async (req, res) => {
  const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;
  if (!token) {
    res.status(400).json({ error: 'Share token is required' });
    return;
  }

  try {
    const file = await db.file.findFirst({
      where: {
        shareToken: token,
      },
      select: {
        id: true,
        name: true,
        content: true,
        sharePermission: true,
        shareExpiresAt: true,
        updatedAt: true,
      },
    });

    if (!file) {
      res.status(404).json({ error: 'Share link not found' });
      return;
    }

    if (file.shareExpiresAt && file.shareExpiresAt.getTime() < Date.now()) {
      res.status(410).json({ error: 'Share link has expired' });
      return;
    }

    const parsed = parseStoredFileContent(file.content);
    res.json({
      file: {
        id: file.id,
        name: file.name,
        updatedAt: file.updatedAt,
      },
      permission: file.sharePermission ?? 'view',
      encryptedPayload: parsed.encryptedPayload,
      elements: parsed.encryptedPayload ? null : parsed.elements,
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
