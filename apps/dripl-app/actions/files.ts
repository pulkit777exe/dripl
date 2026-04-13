'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { db } from '@dripl/db';

async function getSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('dripl-session')?.value;
  if (!token) return null;
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return null;
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as {
      userId?: string;
    };
    return payload.userId ?? null;
  } catch {
    return null;
  }
}

export async function getFiles() {
  const userId = await getSessionUserId();
  if (!userId) return [];
  return db.file.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  });
}

export async function createFile() {
  const userId = await getSessionUserId();
  if (!userId) {
    throw new Error('Unauthorized');
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

export async function getFile(id: string) {
  const userId = await getSessionUserId();
  if (!userId) return null;
  return db.file.findFirst({
    where: { id, userId },
  });
}

export async function updateFile(id: string, content: string, preview?: string) {
  const userId = await getSessionUserId();
  if (!userId) {
    throw new Error('Unauthorized');
  }

  await db.file.updateMany({
    where: { id, userId },
    data: {
      content,
      preview,
    },
  });

  revalidatePath(`/canvas/${id}`);
  revalidatePath('/dashboard');
}
