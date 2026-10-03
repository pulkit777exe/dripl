import crypto from 'node:crypto';
import { db as prisma } from '@dripl/db';
import { isValidSceneContent } from '../lib/sceneValidation';

export const MAX_ROOMS_PER_DAY = 10;
export const MAX_SLUG_ATTEMPTS = 5;

export function generateSlug(): string {
  // Use CSPRNG: 6 random bytes → 8 hexadecimal characters
  return crypto.randomBytes(6).toString('hex').slice(0, 8);
}

export function isValidRoomContent(value: string): boolean {
  try {
    return isValidSceneContent(JSON.parse(value));
  } catch {
    return false;
  }
}

export function parseRoomContent(raw: string): unknown {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isValidSceneContent(parsed)) return parsed;
    if (parsed && typeof parsed === 'object' && 'elements' in parsed) {
      const elements = (parsed as { elements?: unknown }).elements;
      if (isValidSceneContent(elements)) return { elements };
    }
    return { elements: [] };
  } catch {
    return { elements: [] };
  }
}

export type CreateRoomResult = { kind: 'ok'; room: unknown } | { kind: 'rate_limited' };

export type GetRoomResult =
  { kind: 'ok'; room: unknown } | { kind: 'not_found' } | { kind: 'forbidden' };

export type UpdateRoomResult =
  | { kind: 'ok'; room: unknown }
  | { kind: 'not_found' }
  | { kind: 'forbidden' }
  | { kind: 'conflict' };

export type DeleteRoomResult = { kind: 'ok' } | { kind: 'not_found' };

export type AddMemberResult =
  { kind: 'ok'; member: unknown } | { kind: 'not_found' } | { kind: 'conflict' };

export type RemoveMemberResult = { kind: 'ok' } | { kind: 'not_found' } | { kind: 'owner_self' };

export type ShareRoomResult =
  | { kind: 'ok'; token: string; permission: unknown; expiresAt: Date }
  | { kind: 'not_found' }
  | { kind: 'forbidden' };

export type GetShareLinkResult =
  | { kind: 'ok'; room: unknown; permission: unknown; expiresAt: Date | null }
  | { kind: 'not_found' }
  | { kind: 'expired' };

export class RoomService {
  static async listRooms(userId: string): Promise<unknown[]> {
    return prisma.canvasRoom.findMany({
      where: {
        OR: [
          { ownerId: userId },
          {
            members: {
              some: {
                userId,
              },
            },
          },
        ],
      },
      orderBy: {
        updatedAt: 'desc',
      },
      select: {
        id: true,
        slug: true,
        name: true,
        isPublic: true,
        createdAt: true,
        updatedAt: true,
        ownerId: true,
      },
    });
  }

  static async createRoom(options: {
    userId: string;
    name?: string;
    isPublic?: boolean;
    content?: string;
  }): Promise<CreateRoomResult> {
    const { userId, name, isPublic = false, content = '[]' } = options;
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const roomCount = await prisma.canvasRoom.count({
      where: {
        ownerId: userId,
        createdAt: { gte: twentyFourHoursAgo },
      },
    });

    if (roomCount >= MAX_ROOMS_PER_DAY) return { kind: 'rate_limited' };

    let slug = generateSlug();
    let attempts = 0;
    while (attempts < MAX_SLUG_ATTEMPTS) {
      const existing = await prisma.canvasRoom.findUnique({
        where: { slug },
      });
      if (!existing) break;
      slug = generateSlug();
      attempts++;
    }

    const room = await prisma.canvasRoom.create({
      data: {
        slug,
        name: name || 'Untitled Room',
        ownerId: userId,
        isPublic,
        content,
      },
    });

    return { kind: 'ok', room };
  }

  static async getRoom(options: { userId?: string; slug: string }): Promise<GetRoomResult> {
    const { userId, slug } = options;
    const room = await prisma.canvasRoom.findUnique({
      where: { slug },
      include: {
        owner: {
          select: { id: true, name: true, image: true },
        },
        members: {
          select: {
            userId: true,
            role: true,
            user: { select: { id: true, name: true, image: true } },
          },
        },
      },
    });

    if (!room) return { kind: 'not_found' };

    const isOwner = room.ownerId === userId;
    const isMember = room.members.some((m: { userId: string }) => m.userId === userId);

    if (!room.isPublic && !isOwner && !isMember) return { kind: 'forbidden' };

    return { kind: 'ok', room };
  }

  static async updateRoom(options: {
    userId: string;
    slug: string;
    name?: string;
    isPublic?: boolean;
    content?: string;
    expectedUpdatedAt?: Date;
  }): Promise<UpdateRoomResult> {
    const { userId, slug, name, isPublic, content, expectedUpdatedAt } = options;
    const existingRoom = await prisma.canvasRoom.findUnique({
      where: { slug },
      select: { ownerId: true, updatedAt: true },
    });
    if (!existingRoom) return { kind: 'not_found' };
    if (existingRoom.ownerId !== userId) return { kind: 'forbidden' };

    try {
      const updatedRows = await prisma.canvasRoom.updateManyAndReturn({
        where: {
          slug,
          ownerId: userId,
          updatedAt: expectedUpdatedAt ?? existingRoom.updatedAt,
        },
        data: {
          ...(name !== undefined && { name }),
          ...(isPublic !== undefined && { isPublic }),
          ...(content !== undefined && { content }),
        },
      });
      const updatedRoom = updatedRows[0];
      if (!updatedRoom) return { kind: 'conflict' };

      return { kind: 'ok', room: updatedRoom };
    } catch (error) {
      const err = error as { code?: string };
      if (err.code === 'P2025') return { kind: 'not_found' };
      throw error;
    }
  }

  static async deleteRoom(options: { userId: string; slug: string }): Promise<DeleteRoomResult> {
    const { userId, slug } = options;
    const room = await prisma.canvasRoom.findUnique({
      where: { slug, ownerId: userId },
      select: { id: true },
    });

    if (!room) return { kind: 'not_found' };

    await prisma.canvasRoomMember.deleteMany({
      where: { roomId: room.id },
    });

    await prisma.canvasRoom.delete({ where: { slug } });

    return { kind: 'ok' };
  }

  static async addMember(options: {
    userId: string;
    slug: string;
    memberUserId: string;
    role: 'EDITOR' | 'VIEWER';
  }): Promise<AddMemberResult> {
    const { userId, slug, memberUserId, role } = options;
    const room = await prisma.canvasRoom.findUnique({
      where: { slug, ownerId: userId },
      select: { id: true },
    });

    if (!room) return { kind: 'not_found' };

    const existingMember = await prisma.canvasRoomMember.findUnique({
      where: {
        roomId_userId: {
          roomId: room.id,
          userId: memberUserId,
        },
      },
    });

    if (existingMember) return { kind: 'conflict' };

    const member = await prisma.canvasRoomMember.create({
      data: {
        roomId: room.id,
        userId: memberUserId,
        role,
      },
    });

    return { kind: 'ok', member };
  }

  static async removeMember(options: {
    userId: string;
    slug: string;
    memberUserId: string;
  }): Promise<RemoveMemberResult> {
    const { userId, slug, memberUserId } = options;
    const room = await prisma.canvasRoom.findUnique({
      where: { slug, ownerId: userId },
      select: { id: true, ownerId: true },
    });

    if (!room) return { kind: 'not_found' };

    if (room.ownerId === memberUserId) return { kind: 'owner_self' };

    await prisma.canvasRoomMember.deleteMany({
      where: {
        roomId: room.id,
        userId: memberUserId,
      },
    });

    return { kind: 'ok' };
  }

  static async shareRoom(options: {
    userId: string;
    slug: string;
    permission: 'view' | 'edit';
    expiresInHours: number;
  }): Promise<ShareRoomResult> {
    const { userId, slug, permission, expiresInHours } = options;
    const room = await prisma.canvasRoom.findUnique({ where: { slug } });

    if (!room) return { kind: 'not_found' };

    if (room.ownerId !== userId) return { kind: 'forbidden' };

    const token = crypto.randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

    const shareLink = await prisma.shareLink.create({
      data: {
        token,
        roomId: room.id,
        permission: permission.toUpperCase() as 'VIEW' | 'EDIT',
        expiresAt,
        createdById: userId,
      },
    });

    return {
      kind: 'ok',
      token: shareLink.token,
      permission: shareLink.permission,
      expiresAt: shareLink.expiresAt,
    };
  }

  static async getShareLink(token: string): Promise<GetShareLinkResult> {
    const shareLink = await prisma.shareLink.findUnique({
      where: { token },
      include: {
        room: {
          select: {
            id: true,
            slug: true,
            name: true,
            content: true,
            isPublic: true,
          },
        },
      },
    });

    if (!shareLink) return { kind: 'not_found' };

    if (shareLink.expiresAt && shareLink.expiresAt < new Date()) return { kind: 'expired' };

    const parsedRoomContent = parseRoomContent(shareLink.room.content);
    return {
      kind: 'ok',
      room: {
        ...shareLink.room,
        content: JSON.stringify(parsedRoomContent),
      },
      permission: shareLink.permission,
      expiresAt: shareLink.expiresAt,
    };
  }

  static async listSharedRooms(userId: string): Promise<unknown[]> {
    return prisma.canvasRoomMember.findMany({
      where: { userId },
      include: {
        room: {
          select: {
            id: true,
            slug: true,
            name: true,
            isPublic: true,
            createdAt: true,
            updatedAt: true,
            owner: {
              select: {
                id: true,
                name: true,
                image: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
