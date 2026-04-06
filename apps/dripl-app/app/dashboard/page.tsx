"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileBrowser } from "@/components/dashboard/FileBrowser";
import { useAuth } from "@/app/context/AuthContext";
import { apiClient, type FileSummary, type FolderSummary } from "@/lib/api";

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [files, setFiles] = useState<FileSummary[]>([]);
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const loadData = useCallback(async (searchValue: string) => {
    setLoading(true);
    try {
      const [filesResponse, foldersResponse] = await Promise.all([
        apiClient.listFiles({
          search: searchValue || undefined,
        }),
        apiClient.listFolders(),
      ]);
      setFiles(filesResponse.files);
      setFolders(foldersResponse.folders);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/auth/login");
      return;
    }
    void loadData("");
  }, [authLoading, loadData, router, user]);

  useEffect(() => {
    if (!user) return;
    const timeout = window.setTimeout(() => {
      void loadData(search.trim());
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [loadData, search, user]);

  const handleCreateFile = useCallback(async () => {
    const file = await apiClient.createFile({ name: "Untitled file" });
    router.push(`/canvas/${file.id}`);
  }, [router]);

  const handleDeleteFile = useCallback(async (id: string) => {
    await apiClient.deleteFile(id);
    setFiles((prev) => prev.filter((file) => file.id !== id));
  }, []);

  const handleRenameFile = useCallback(async (id: string, name: string) => {
    await apiClient.updateFile(id, { name });
    setFiles((prev) =>
      prev.map((file) => (file.id === id ? { ...file, name } : file)),
    );
  }, []);

  const handleCreateFolder = useCallback(async () => {
    const name = window.prompt("Folder name");
    if (!name || !name.trim()) return;
    const response = await apiClient.createFolder({ name: name.trim() });
    setFolders((prev) => [response.folder, ...prev]);
  }, []);

  const fileItems = useMemo(
    () =>
      files.map((file) => ({
        id: file.id,
        name: file.name,
        updatedAt: file.updatedAt,
        createdAt: file.createdAt,
        preview: file.preview,
      })),
    [files],
  );

  if (authLoading || loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-[#f5f0e8]">
        <p className="text-[#7a7267]">Loading dashboard...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="flex h-dvh w-full flex-col bg-[#f5f0e8] text-[#1a1a1a]">
      <div className="border-b border-[#d4c9b8] px-8 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search files by name"
            className="h-10 min-w-[260px] rounded-sm border border-[#d4c9b8] bg-white px-3 text-sm outline-none focus:border-[#1a1a1a]"
          />
          <button
            onClick={handleCreateFolder}
            className="h-10 rounded-sm border border-[#1a1a1a] px-4 text-sm font-semibold"
          >
            New folder
          </button>
          <p className="text-xs text-[#7a7267]">
            {folders.length} folder{folders.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>
      <FileBrowser
        files={fileItems}
        onCreateFile={handleCreateFile}
        onStartNewCanvas={handleCreateFile}
        onDeleteFile={handleDeleteFile}
        onRenameFile={handleRenameFile}
      />
    </div>
  );
}
