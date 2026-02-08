"use server";

import { db } from "@dripl/db";
import { currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

export async function getFiles() {
  const user = await currentUser();
  if (!user) return [];
  if (!user.emailAddresses[0]) {
    revalidatePath("/");
    throw new Error("User has no email address");
  }
  const dbUser = await db.user.upsert({
    where: { id: user.id },
    update: {
      email: user.emailAddresses[0].emailAddress,
      name: `${user.firstName} ${user.lastName}`,
      image: user.imageUrl,
    },
    create: {
      id: user.id,
      password: "",
      email: user.emailAddresses[0].emailAddress,
      name: `${user.firstName} ${user.lastName}`,
      image: user.imageUrl,
    },
  });

  const files = await db.file.findMany({
    where: { userId: dbUser.id },
    orderBy: { updatedAt: "desc" },
  });

  return files;
}

export async function createFile() {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const count = await db.file.count({
    where: { userId: user.id },
  });

  if (count >= 3) {
    throw new Error("Free plan limit reached (3 files max).");
  }

  const file = await db.file.create({
    data: {
      name: "Untitled File",
      userId: user.id,
      content: "[]",
    },
  });

  revalidatePath("/dashboard");
  return file;
}

export async function getFile(id: string) {
  const user = await currentUser();
  if (!user) return null;

  const file = await db.file.findUnique({
    where: { id },
  });

  if (!file || file.userId !== user.id) {
    return null;
  }

  return file;
}

export async function updateFile(
  id: string,
  content: string,
  preview?: string,
) {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  await db.file.update({
    where: { id },
    data: {
      content,
      preview,
    },
  });

  revalidatePath(`/file/${id}`);
  revalidatePath("/dashboard");
}
