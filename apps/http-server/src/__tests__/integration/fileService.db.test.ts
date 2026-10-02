import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db, initializeDb } from '@dripl/db';
import { FileService } from '../../services/fileService';

const run = process.env.RUN_DB_INTEGRATION === 'true';
const describeIntegration = run ? describe : describe.skip;

const element = {
  id: 'db-element',
  type: 'rectangle' as const,
  x: 0,
  y: 0,
  width: 100,
  height: 80,
};

describeIntegration('FileService with PostgreSQL', () => {
  const userId = randomUUID();
  const fileId = randomUUID();
  const email = `dripl-db-${userId}@example.test`;

  beforeAll(async () => {
    await initializeDb();
    await db.user.create({
      data: { id: userId, email, emailVerified: true, name: 'DB Test' },
    });
    await db.file.create({
      data: {
        id: fileId,
        userId,
        name: 'DB Canvas',
        content: JSON.stringify([element]),
      },
    });
  });

  afterAll(async () => {
    await db.file.deleteMany({ where: { userId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  });

  it('enforces owner scope and rejects malformed scenes', async () => {
    await expect(
      FileService.updateFile({
        userId: randomUUID(),
        fileId,
        content: [element],
      })
    ).resolves.toBeNull();

    await expect(
      FileService.updateFile({
        userId,
        fileId,
        content: [{ id: 'incomplete' }],
      })
    ).resolves.toEqual({ kind: 'invalid_scene' });
  });

  it('rejects a stale optimistic save after a concurrent write', async () => {
    const before = await FileService.getFile(userId, fileId);
    expect(before).not.toBeNull();

    await db.file.update({
      where: { id: fileId },
      data: { name: 'Concurrent rename' },
    });

    await expect(
      FileService.updateFile({
        userId,
        fileId,
        name: 'Stale save',
        expectedUpdatedAt: before!.updatedAt,
      })
    ).resolves.toEqual({ kind: 'conflict' });
  });
});
