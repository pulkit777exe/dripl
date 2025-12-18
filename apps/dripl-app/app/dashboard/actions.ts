"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createFile } from "../../actions/files";

export async function handleCreateFile() {
  try {
    const file = await createFile();
    if (file) {
      revalidatePath("/dashboard");
      redirect(`/file/${file.id}`);
    }
  } catch (error) {
    console.error("Failed to create file:", error);
    throw new Error("Failed to create file");
  }
}