import { Router, type Response } from 'express';
import { z } from 'zod';
import { MAX_FILE_CONTENT_BYTES } from '@dripl/common';
import { RoomService, isValidRoomContent } from '../services/roomService';
import { authMiddleware } from '../middlewares/authMiddleware';
import { sendError } from '../lib/response';
import { defineRoute } from '../lib/route';

// Scene size is measured in UTF-8 bytes — the unit MAX_FILE_CONTENT_BYTES
// names and the unit files.ts enforces. z.string().max() counts UTF-16
// code units instead, so multibyte scenes passed here while failing there.
// The schema refine stays as defense in depth; the routes answer 413 via
// rejectOversizedContent so both paths report oversize the same way.
export const roomContentSchema = z
  .string()
  .refine(
    content => Buffer.byteLength(content, 'utf8') <= MAX_FILE_CONTENT_BYTES,
    `Room content must not exceed ${MAX_FILE_CONTENT_BYTES} bytes`
  )
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
  // Wire vocabulary is lowercase view/edit (product decision 2026-10-01:
  // one casing on the wire, DB keeps its EDITOR/VIEWER enum — mapping
  // happens here at the route boundary). Default stays the old EDITOR
  // grant, expressed in wire terms.
  role: z.enum(['view', 'edit']).default('edit'),
});

const ROLE_TO_DB = { view: 'VIEWER', edit: 'EDITOR' } as const;
const ROLE_FROM_DB = { EDITOR: 'edit', VIEWER: 'view' } as const;

function toWireRole(role: unknown): unknown {
  return typeof role === 'string' && role in ROLE_FROM_DB
    ? ROLE_FROM_DB[role as keyof typeof ROLE_FROM_DB]
    : role;
}

function toWireMember(member: unknown): unknown {
  if (!member || typeof member !== 'object') return member;
  const record = member as Record<string, unknown>;
  return 'role' in record ? { ...record, role: toWireRole(record.role) } : member;
}

// Only getRoom embeds members[].role today (listRooms/getShareLink select
// no members); apply this to any future room response that does.
function toWireRoom(room: unknown): unknown {
  if (!room || typeof room !== 'object') return room;
  const record = room as Record<string, unknown>;
  if (!Array.isArray(record.members)) return room;
  return { ...record, members: record.members.map(toWireMember) };
}

const shareRoomSchema = z.object({
  permission: z.enum(['view', 'edit']).default('view'),
  expiresIn: z.number().min(1).max(720).default(24),
});

const router: Router = Router();

function invalidPayload(res: Response, message: string, details: unknown): void {
  res.status(400).json({
    error: 'INVALID_PAYLOAD',
    message,
    statusCode: 400,
    details,
  });
}

// Size-before-semantics, same order and status as files.ts: an oversized
// payload is 413 PAYLOAD_TOO_LARGE, not a 400 schema violation. Runs before
// parsing so a 2MB+ string is never walked by Zod.
function rejectOversizedContent(res: Response, body: unknown): boolean {
  const content = (body as { content?: unknown } | null | undefined)?.content;
  if (typeof content !== 'string') return false;
  const size = Buffer.byteLength(content, 'utf8');
  if (size <= MAX_FILE_CONTENT_BYTES) return false;
  sendError(
    res,
    413,
    'PAYLOAD_TOO_LARGE',
    `Room content too large (${size} bytes, max ${MAX_FILE_CONTENT_BYTES})`
  );
  return true;
}

// Public capability-link resolution must be mounted before authentication.
// The token is the authorization credential; do not make shared rooms
// inaccessible merely because the viewer has no Dripl account.
router.get(
  '/share/:token',
  defineRoute({
    auth: 'none',
    errors: {
      not_found: 'Share link not found',
      expired: 'Share link has expired',
    },
    event: 'fetch_share_link_error',
    handler: async ({ req, res }) => {
      res.set('Cache-Control', 'no-store');
      const { token } = req.params as { token: string };
      // Length guard before the DB, same contract as the file-share routes:
      // issued tokens are short, so an overlong value answers the same 404 a
      // miss gets — wire-identical, no huge string reaches Prisma.
      if (typeof token !== 'string' || token.length > 512) {
        sendError(res, 404, 'NOT_FOUND', 'Share link not found');
        return;
      }

      const result = await RoomService.getShareLink(token);
      if (result.kind !== 'ok') return result;

      res.json({
        room: result.room,
        permission: result.permission,
        expiresAt: result.expiresAt,
      });
      return result;
    },
  })
);

router.use(authMiddleware);

router.get(
  '/',
  defineRoute({
    auth: 'required',
    event: 'fetch_rooms_error',
    handler: async ({ userId, res }) => {
      const rooms = await RoomService.listRooms(userId);
      res.json({ rooms });
    },
  })
);

router.post(
  '/',
  defineRoute({
    auth: 'required',
    // Parsed manually inside the handler (after rejectOversizedContent) rather
    // than via `body:` so an oversized scene answers 413 before Zod walks it.
    // The 400 below replicates the invalidBody envelope.
    errors: {
      rate_limited: 'Room creation limit reached. You can create up to 10 rooms per day.',
    },
    event: 'create_room_error',
    handler: async ({ userId, req, res }) => {
      if (rejectOversizedContent(res, req.body)) return;

      const parsed = createRoomSchema.safeParse(req.body);
      if (!parsed.success) {
        invalidPayload(res, 'Invalid payload', parsed.error.flatten());
        return;
      }

      const { name, isPublic = false, content = '[]' } = parsed.data;

      const result = await RoomService.createRoom({ userId, name, isPublic, content });
      if (result.kind !== 'ok') return result;

      res.status(201).json({
        status: 'room created',
        room: result.room,
      });
      return result;
    },
  })
);

router.get(
  '/shared',
  defineRoute({
    auth: 'required',
    event: 'fetch_shared_rooms_error',
    handler: async ({ userId, res }) => {
      const rooms = await RoomService.listSharedRooms(userId);
      res.json({ rooms });
    },
  })
);

router.get(
  '/:slug',
  defineRoute({
    auth: 'required',
    errors: {
      not_found: 'Room not found',
      forbidden: 'Access denied',
    },
    event: 'fetch_room_error',
    handler: async ({ userId, req, res }) => {
      const { slug } = req.params as { slug: string };

      const result = await RoomService.getRoom({ userId, slug });
      if (result.kind !== 'ok') return result;

      res.json({ room: toWireRoom(result.room) });
      return result;
    },
  })
);

router.put(
  '/:slug',
  defineRoute({
    auth: 'required',
    // Same size-before-semantics ordering as POST /: manual parse after the
    // 413 guard so oversize answers 413, not a 400 schema violation.
    errors: {
      not_found: 'Room not found or you do not have permission',
      forbidden: 'Only the owner can update this room',
      conflict: 'Room changed while saving',
    },
    event: 'update_room_error',
    handler: async ({ userId, req, res }) => {
      const { slug } = req.params as { slug: string };

      if (rejectOversizedContent(res, req.body)) return;

      const parsed = updateRoomSchema.safeParse(req.body);
      if (!parsed.success) {
        invalidPayload(res, 'Invalid update payload', parsed.error.flatten());
        return;
      }

      const { name, isPublic, content, expectedUpdatedAt } = parsed.data;

      const result = await RoomService.updateRoom({
        userId,
        slug,
        name,
        isPublic,
        content,
        expectedUpdatedAt,
      });
      if (result.kind !== 'ok') return result;

      res.json({
        status: 'room updated',
        room: result.room,
      });
      return result;
    },
  })
);

router.delete(
  '/:slug',
  defineRoute({
    auth: 'required',
    errors: {
      not_found: 'Room not found or you do not have permission',
    },
    event: 'delete_room_error',
    handler: async ({ userId, req, res }) => {
      const { slug } = req.params as { slug: string };

      const result = await RoomService.deleteRoom({ userId, slug });
      if (result.kind !== 'ok') return result;

      res.json({ status: 'room deleted' });
      return result;
    },
  })
);

// management
router.post(
  '/:slug/members',
  defineRoute({
    auth: 'required',
    body: addMemberSchema,
    invalidBody: { message: 'Invalid payload' },
    errors: {
      not_found: 'Room not found or you do not have permission',
      conflict: 'User is already a member of this room',
    },
    event: 'add_member_error',
    handler: async ({ userId, body, req, res }) => {
      const { slug } = req.params as { slug: string };

      const { userId: memberUserId, role } = body;

      const result = await RoomService.addMember({
        userId,
        slug,
        memberUserId,
        role: ROLE_TO_DB[role],
      });
      if (result.kind !== 'ok') return result;

      res.status(201).json({
        status: 'member added',
        member: toWireMember(result.member),
      });
      return result;
    },
  })
);

router.delete(
  '/:slug/members/:userId',
  defineRoute({
    auth: 'required',
    errors: {
      not_found: 'Room not found or you do not have permission',
      owner_self: 'Owner cannot remove themselves from the room',
    },
    event: 'remove_member_error',
    handler: async ({ userId, req, res }) => {
      const { slug, userId: memberUserId } = req.params as { slug: string; userId: string };

      const result = await RoomService.removeMember({ userId, slug, memberUserId });
      if (result.kind !== 'ok') return result;

      res.json({ status: 'member removed' });
      return result;
    },
  })
);

// sharing (requires auth)
router.post(
  '/:slug/share',
  defineRoute({
    auth: 'required',
    body: shareRoomSchema,
    invalidBody: { message: 'Invalid payload' },
    errors: {
      not_found: 'Room not found',
      forbidden: 'Only the owner can share this room',
    },
    event: 'create_share_link_error',
    handler: async ({ userId, body, req, res }) => {
      const { slug } = req.params as { slug: string };

      const { permission, expiresIn } = body;

      const result = await RoomService.shareRoom({
        userId,
        slug,
        permission,
        expiresInHours: expiresIn,
      });
      if (result.kind !== 'ok') return result;

      res.status(201).json({
        status: 'share link created',
        token: result.token,
        url: `${process.env.NEXT_PUBLIC_APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000'}/board/${result.token}`,
        permission: result.permission,
        expiresAt: result.expiresAt,
      });
      return result;
    },
  })
);

export default router;
