import { initializeDb } from '@dripl/db';

/**
 * Ownership for the snapshot collection routes.
 *
 * The gap this closes: `canvasId` used to be a free-form string that the client
 * echoed and the server believed. Nothing bound it to a `File` row, so any
 * caller who learned or guessed a slug could write snapshots under it and read
 * the whole version history back out of it. A slug is not a capability; a `File`
 * row with a matching `userId` is.
 *
 * `File.userId` is the same value the session JWT's `userId` carries and the
 * same field `http-server`'s `FileService.getFile(userId, fileId)` filters on,
 * so "owns this canvas" means exactly what it means in the REST API. Team-owned
 * files (`File.teamId` set, `File.userId` null) have no owner here and are
 * denied; the app never creates them, and resolving team membership is not this
 * change's job.
 *
 * The one query is written so that *PostgreSQL* cannot tell the two cases apart:
 * `where: { id, userId }` returns the same empty result for "no such canvas"
 * and "not your canvas". Nothing downstream can branch on a distinction the
 * query never made, which is what lets the route answer both with one 403.
 */
export async function resolveOwnedCanvasId(
  canvasId: string,
  userId: string
): Promise<string | null> {
  const client = await initializeDb();
  const file = await client.file.findFirst({
    where: { id: canvasId, userId },
    select: { id: true },
  });
  return file?.id ?? null;
}
