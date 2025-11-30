import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { FileBrowser } from "@/components/dashboard/FileBrowser";
import { getFiles, createFile } from "@/actions/files";
import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";

export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) redirect("/");

  const files = await getFiles();

  async function handleCreate() {
    "use server";
    const file = await createFile();
    if (file) {
      redirect(`/file/${file.id}`);
    }
  }

  return (
    <div className="flex h-screen w-full bg-zinc-950 text-white">
      <DashboardSidebar />
      <FileBrowser files={files} onCreateFile={handleCreate} />
    </div>
  );
}
