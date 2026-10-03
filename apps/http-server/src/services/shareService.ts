import { randomBytes } from 'node:crypto';
import { db } from '@dripl/db';
import { parseStoredFileContent } from '../lib/encrypt';
import { isValidSceneContent } from '../lib/sceneValidation';

export interface ResolveShareResult {
  file: {
    id: string;
    name: string;
    updatedAt: Date;
  };
  permission: string;
  encryptedPayload: unknown;
  elements: unknown;
  expired: boolean;
}

export type SharePermission = 'view' | 'edit';

export type UpsertShareResult =
  { kind: 'ok'; token: string | null } | { kind: 'not_found' } | { kind: 'forbidden' };

const TOKEN_BYTES = 24;

function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export class ShareService {
  static async resolveShare(token: string): Promise<ResolveShareResult | null> {
    const file = await db.file.findFirst({
      where: { shareToken: token },
      select: {
        id: true,
        name: true,
        content: true,
        sharePermission: true,
        shareExpiresAt: true,
        updatedAt: true,
      },
    });

    if (!file || !file.sharePermission) return null;

    const expired = Boolean(file.shareExpiresAt && file.shareExpiresAt.getTime() < Date.now());
    const parsed = parseStoredFileContent(file.content);
    const elements = isValidSceneContent(parsed.elements) ? parsed.elements : [];

    return {
      file: { id: file.id, name: file.name, updatedAt: file.updatedAt },
      permission: file.sharePermission,
      encryptedPayload: parsed.encryptedPayload,
      elements: parsed.encryptedPayload ? null : elements,
      expired,
    };
  }

  /**
   * Idempotently set a file's share token + permission for the
   * given user. Only the file owner may modify its share state.
   *
   * Returns a discriminated result so the route layer can map to
   * the right HTTP status without inspecting error shapes.
   */
  static async upsertShareToken(
    fileId: string,
    userId: string,
    permission: SharePermission | null
  ): Promise<UpsertShareResult> {
    const file = await db.file.findFirst({
      where: { id: fileId },
      select: {
        id: true,
        userId: true,
        shareToken: true,
        sharePermission: true,
        shareExpiresAt: true,
        updatedAt: true,
      },
    });

    if (!file) return { kind: 'not_found' };
    if (file.userId !== userId) return { kind: 'forbidden' };

    // Revoke: explicit null clears the share state.
    if (permission === null) {
      const revoked = await db.file.updateMany({
        where: { id: fileId, userId, updatedAt: file.updatedAt },
        data: { shareToken: null, sharePermission: null, shareExpiresAt: null },
      });
      if (revoked.count === 0) return { kind: 'not_found' };
      return { kind: 'ok', token: null };
    }

    // Idempotent: if the existing token + permission already match,
    // don't rotate the token (would invalidate live shared links).
    if (
      file.shareToken &&
      file.sharePermission === permission &&
      (!file.shareExpiresAt || file.shareExpiresAt.getTime() > Date.now())
    ) {
      return { kind: 'ok', token: file.shareToken };
    }

    // New or permission changed: rotate.
    const token = generateToken();
    const updated = await db.file.updateMany({
      where: { id: fileId, userId, updatedAt: file.updatedAt },
      data: { shareToken: token, sharePermission: permission, shareExpiresAt: null },
    });
    if (updated.count === 0) return { kind: 'not_found' };
    return { kind: 'ok', token };
  }
}
