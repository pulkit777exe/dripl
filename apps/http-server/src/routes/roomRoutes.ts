import { Router, type Response } from 'express';
import { z } from 'zod';
import { MAX_FILE_CONTENT_BYTES } from '@dripl/common';
import { RoomService, isValidRoomContent } from '../services/roomService';
import { authMiddleware, type AuthenticatedRequest } from '../middlewares/authMiddleware';
import { sendError } from '../lib/response';
import { logger } from '../logger';

const router: Router = Router();

const roomContentSchema = z
  .string()
  .max(MAX_FILE_CONTENT_BYTES)
  .refine(isValidRoomContent, 'Room content must contain a valid element scene');

const createRoomSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  isPublic: z.boolean().optional(),
  content: roomContentSchema.optional(),
});

const updateRoomSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  isPublic: z.boolean().optional(),
  content: roomContentSchema.optional(),
  expectedUpdatedAt: z.coerce.date().optional(),
});

const addMemberSchema = z.object({
  userId: z.string().min(1).max(100),
  role: z.enum(['EDITOR', 'VIEWER']).default('EDITOR'),
});

const shareRoomSchema = z.object({
  permission: z.enum(['view', 'edit']).default('view'),
  expiresIn: z.number().min(1).max(720).default(24),
});

function invalidPayload(res: Response, message: string, details: unknown): void {
  res.status(400).json({
    error: 'INVALID_PAYLOAD',
    message,
    statusCode: 400,
    details,
  });
}

function requireUserId(req: AuthenticatedRequest, res: Response): string | null {
  if (!req.userId) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return null;
  }
  return req.userId;
}

// Public capability-link resolution must be mounted before authentication.
// The token is the authorization credential; do not make shared rooms
// inaccessible merely because the viewer has no Dripl account.
router.get('/share/:token', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { token } = req.params as { token: string };

  try {
    const result = await RoomService.getShareLink(token);
    if (result.kind === 'not_found') {
      sendError(res, 404, 'NOT_FOUND', 'Share link not found');
      return;
    }
    if (result.kind === 'expired') {
      sendError(res, 410, 'EXPIRED', 'Share link has expired');
      return;
    }

    res.json({
      room: result.room,
      permission: result.permission,
      expiresAt: result.expiresAt,
    });
  } catch (error) {
    logger.error({ event: 'fetch_share_link_error', error }, 'Failed to fetch share link');
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.use(authMiddleware);

router.get('/', async (req: AuthenticatedRequest, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    const rooms = await RoomService.listRooms(userId);
    res.json({ rooms });
  } catch (error) {
    logger.error({ event: 'fetch_rooms_error', error }, 'Failed to fetch rooms');
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.post('/', async (req: AuthenticatedRequest, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const parsed = createRoomSchema.safeParse(req.body);
  if (!parsed.success) {
    invalidPayload(res, 'Invalid payload', parsed.error.flatten());
    return;
  }

  const { name, isPublic = false, content = '[]' } = parsed.data;

  try {
    const result = await RoomService.createRoom({ userId, name, isPublic, content });
    if (result.kind === 'rate_limited') {
      sendError(
        res,
        429,
        'RATE_LIMITED',
        'Room creation limit reached. You can create up to 10 rooms per day.'
      );
      return;
    }

    res.status(201).json({
      status: 'room created',
      room: result.room,
    });
  } catch (error) {
    logger.error({ event: 'create_room_error', error }, 'Failed to create room');
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.get('/shared', async (req: AuthenticatedRequest, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    const rooms = await RoomService.listSharedRooms(userId);
    res.json({ rooms });
  } catch (error) {
    logger.error({ event: 'fetch_shared_rooms_error', error }, 'Failed to fetch shared rooms');
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.get('/:slug', async (req: AuthenticatedRequest, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const { slug } = req.params as { slug: string };

  try {
    const result = await RoomService.getRoom({ userId, slug });
    if (result.kind === 'not_found') {
      sendError(res, 404, 'NOT_FOUND', 'Room not found');
      return;
    }
    if (result.kind === 'forbidden') {
      sendError(res, 403, 'FORBIDDEN', 'Access denied');
      return;
    }

    res.json({ room: result.room });
  } catch (error) {
    logger.error({ event: 'fetch_room_error', error }, 'Failed to fetch room');
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.put('/:slug', async (req: AuthenticatedRequest, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const { slug } = req.params as { slug: string };

  const parsed = updateRoomSchema.safeParse(req.body);
  if (!parsed.success) {
    invalidPayload(res, 'Invalid update payload', parsed.error.flatten());
    return;
  }

  const { name, isPublic, content, expectedUpdatedAt } = parsed.data;

  try {
    const result = await RoomService.updateRoom({
      userId,
      slug,
      name,
      isPublic,
      content,
      expectedUpdatedAt,
    });
    if (result.kind === 'not_found') {
      sendError(res, 404, 'NOT_FOUND', 'Room not found or you do not have permission');
      return;
    }
    if (result.kind === 'forbidden') {
      sendError(res, 403, 'FORBIDDEN', 'Only the owner can update this room');
      return;
    }
    if (result.kind === 'conflict') {
      sendError(res, 409, 'CONFLICT', 'Room changed while saving');
      return;
    }

    res.json({
      status: 'room updated',
      room: result.room,
    });
  } catch (error) {
    logger.error({ event: 'update_room_error', error }, 'Failed to update room');
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.delete('/:slug', async (req: AuthenticatedRequest, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const { slug } = req.params as { slug: string };

  try {
    const result = await RoomService.deleteRoom({ userId, slug });
    if (result.kind === 'not_found') {
      sendError(res, 404, 'NOT_FOUND', 'Room not found or you do not have permission');
      return;
    }

    res.json({ status: 'room deleted' });
  } catch (error) {
    logger.error({ event: 'delete_room_error', error }, 'Failed to delete room');
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

// management
router.post('/:slug/members', async (req: AuthenticatedRequest, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const { slug } = req.params as { slug: string };

  const parsed = addMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    invalidPayload(res, 'Invalid payload', parsed.error.flatten());
    return;
  }

  const { userId: memberUserId, role } = parsed.data;

  try {
    const result = await RoomService.addMember({ userId, slug, memberUserId, role });
    if (result.kind === 'not_found') {
      sendError(res, 404, 'NOT_FOUND', 'Room not found or you do not have permission');
      return;
    }
    if (result.kind === 'conflict') {
      sendError(res, 409, 'CONFLICT', 'User is already a member of this room');
      return;
    }

    res.status(201).json({
      status: 'member added',
      member: result.member,
    });
  } catch (error) {
    logger.error({ event: 'add_member_error', error }, 'Failed to add member');
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.delete('/:slug/members/:userId', async (req: AuthenticatedRequest, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const { slug, userId: memberUserId } = req.params as { slug: string; userId: string };

  try {
    const result = await RoomService.removeMember({ userId, slug, memberUserId });
    if (result.kind === 'not_found') {
      sendError(res, 404, 'NOT_FOUND', 'Room not found or you do not have permission');
      return;
    }
    if (result.kind === 'owner_self') {
      sendError(res, 400, 'INVALID_PAYLOAD', 'Owner cannot remove themselves from the room');
      return;
    }

    res.json({ status: 'member removed' });
  } catch (error) {
    logger.error({ event: 'remove_member_error', error }, 'Failed to remove member');
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

// sharing (requires auth)
router.post('/:slug/share', async (req: AuthenticatedRequest, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const { slug } = req.params as { slug: string };

  const parsed = shareRoomSchema.safeParse(req.body);
  if (!parsed.success) {
    invalidPayload(res, 'Invalid payload', parsed.error.flatten());
    return;
  }

  const { permission, expiresIn } = parsed.data;

  try {
    const result = await RoomService.shareRoom({
      userId,
      slug,
      permission,
      expiresInHours: expiresIn,
    });
    if (result.kind === 'not_found') {
      sendError(res, 404, 'NOT_FOUND', 'Room not found');
      return;
    }
    if (result.kind === 'forbidden') {
      sendError(res, 403, 'FORBIDDEN', 'Only the owner can share this room');
      return;
    }

    res.status(201).json({
      status: 'share link created',
      token: result.token,
      url: `${process.env.NEXT_PUBLIC_APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000'}/board/${result.token}`,
      permission: result.permission,
      expiresAt: result.expiresAt,
    });
  } catch (error) {
    logger.error({ event: 'create_share_link_error', error }, 'Failed to create share link');
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

export default router;
