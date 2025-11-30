"use server";

import { prisma } from "@dripl/database";
import { currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

export async function getFiles() {
  const user = await currentUser();
  if (!user) return [];
  if (!user.emailAddresses[0]) {
    revalidatePath("/");
    throw new Error("User has no email address");
  }
  // Ensure user exists in DB
  const dbUser = await prisma.user.upsert({
    where: { id: user.id },
    update: {
      email: user.emailAddresses[0].emailAddress,
      name: `${user.firstName} ${user.lastName}`,
      image: user.imageUrl,
    },
    create: {
      id: user.id,
      email: user.emailAddresses[0].emailAddress,
      name: `${user.firstName} ${user.lastName}`,
      image: user.imageUrl,
    },
  });

  const files = await prisma.file.findMany({
    where: { userId: dbUser.id },
    orderBy: { updatedAt: "desc" },
  });

  return files;
}

export async function createFile() {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const count = await prisma.file.count({
    where: { userId: user.id },
  });

  if (count >= 3) {
    throw new Error("Free plan limit reached (3 files max).");
  }

  const file = await prisma.file.create({
    data: {
      name: "Untitled File",
      userId: user.id,
      content: "[]", // Empty array of elements
    },
  });

  revalidatePath("/dashboard");
  return file;
}

export async function getFile(id: string) {
  const user = await currentUser();
  if (!user) return null;

  const file = await prisma.file.findUnique({
    where: { id },
  });

  if (!file || file.userId !== user.id) {
    // TODO: Handle team/shared files check here
    return null;
  }

  return file;
}

export async function updateFile(
  id: string,
  content: string,
  preview?: string
) {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  await prisma.file.update({
    where: { id },
    data: {
      content,
      preview,
    },
  });

  revalidatePath(`/file/${id}`);
  revalidatePath("/dashboard");
}
