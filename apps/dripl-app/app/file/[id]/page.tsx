import { getFile } from "@/actions/files";
import { RemoteCanvas } from "@/components/canvas/RemoteCanvas";
import { redirect } from "next/navigation";

export default async function FilePage({ params }: { params: { id: string } }) {
  const { id } = await params;
  const file = await getFile(id);

  if (!file) {
    redirect("/dashboard");
  }

  const initialData = JSON.parse(file.content);

  return <RemoteCanvas fileId={file.id} initialData={initialData} />;
}
