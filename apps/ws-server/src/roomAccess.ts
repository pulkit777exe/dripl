import { db } from '@dripl/db';

export type RoomAccess = {
  allowed: boolean;
  canEdit: boolean;
  recordType?: 'file' | 'canvasRoom';
};

const DENIED: RoomAccess = { allowed: false, canEdit: false };

/**
 * Resolve access at the collaboration seam instead of trusting a client-
 * supplied room id. A file id and a room slug are both supported because the
 * editor currently uses the same transport for both persistence models.
 */
export async function authorizeShareRoomAccess(
  fileId: string,
  roomId: string,
  permission: 'view' | 'edit',
  expectedToken?: string
): Promise<RoomAccess> {
  if (fileId !== roomId) return DENIED;
  const file = await db.file.findFirst({
    where: { id: fileId },
    select: { shareToken: true, sharePermission: true, shareExpiresAt: true },
  });
  if (!file || !file.sharePermission || (expectedToken && file.shareToken !== expectedToken)) {
    return DENIED;
  }
  if (file.shareExpiresAt && file.shareExpiresAt.getTime() < Date.now()) return DENIED;
  const currentPermission = file.sharePermission === 'edit' ? 'edit' : 'view';
  if (currentPermission !== permission) return DENIED;
  return { allowed: true, canEdit: currentPermission === 'edit', recordType: 'file' };
}

export async function authorizeRoomAccess(userId: string, roomId: string): Promise<RoomAccess> {
  const file = await db.file.findFirst({
    where: { id: roomId },
    select: {
      userId: true,
      teamId: true,
      sharedWith: {
        where: { userId },
        select: { userId: true },
        take: 1,
      },
      team: {
        select: {
          members: {
            where: { userId },
            select: { userId: true },
            take: 1,
          },
        },
      },
    },
  });

  if (file) {
    const isOwner = file.userId === userId;
    const isTeamMember = Boolean(file.team?.members.length);
    const isShared = file.sharedWith.length > 0;
    return {
      allowed: isOwner || isTeamMember || isShared,
      // Shared files currently have no write-permission field; keep them
      // read-only until the product contract explicitly grants edit access.
      canEdit: isOwner || isTeamMember,
      recordType: 'file',
    };
  }

  const canvasRoom = await db.canvasRoom.findUnique({
    where: { slug: roomId },
    select: {
      ownerId: true,
      isPublic: true,
      members: {
        where: { userId },
        select: { role: true },
        take: 1,
      },
    },
  });

  if (!canvasRoom) return DENIED;

  const isOwner = canvasRoom.ownerId === userId;
  const isEditor = canvasRoom.members[0]?.role === 'EDITOR';
  return {
    allowed: canvasRoom.isPublic || isOwner || canvasRoom.members.length > 0,
    canEdit: isOwner || isEditor,
    recordType: 'canvasRoom',
  };
}
