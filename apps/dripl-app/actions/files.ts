'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { db } from '@dripl/db';
import { verifyToken } from '@dripl/utils/auth';

// Kept in step with FileService.createFile in apps/http-server.
const FREE_PLAN_FILE_LIMIT = 3;

async function getSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('dripl-session')?.value;
  if (!token) return null;
  try {
    return verifyToken(token)?.userId ?? null;
  } catch {
    return null;
  }
}

export async function createFile() {
  const userId = await getSessionUserId();
  if (!userId) {
    throw new Error('Unauthorized');
  }

  // Parity with FileService.createFile: the REST path rejects past the free
  // plan limit, and this action previously did not, so a client reaching this
  // Server Action bypassed the cap entirely.
  const ownedFileCount = await db.file.count({ where: { userId } });
  if (ownedFileCount >= FREE_PLAN_FILE_LIMIT) {
    throw new Error(
      `Free plan limit reached (${FREE_PLAN_FILE_LIMIT} canvases). Delete one or upgrade to Premium.`
    );
  }

  const file = await db.file.create({
    data: {
      name: 'Untitled file',
      userId,
      content: JSON.stringify({ elements: [] }),
    },
  });

  revalidatePath('/dashboard');
  return file;
}

// getFiles, getFile, and updateFile were removed 2026-09-27: zero callers,
// and updateFile wrote through a bare updateMany with no optimistic fence and
// no scene validation, unlike FileService.updateFile. Canvas reads/writes go
// through apiClient (REST) — see app/dashboard/page.tsx and app/file/[id].
