import { getFile } from "@/actions/files";
import { RemoteCanvas } from "@/components/canvas/RemoteCanvas";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function FilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  const file = await getFile(id);

  if (!file) {
    redirect("/dashboard");
  }

  const initialData = JSON.parse(file.content);
  const isOwner = user && user.id === file.userId;

  return <RemoteCanvas fileId={file.id} initialData={initialData} readOnly={!isOwner} isAuthenticated={!!user} />;
}
