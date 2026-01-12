"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import { apiClient } from "../../lib/api/client";
import { FileBrowser } from "../../components/dashboard/FileBrowser";

type File = {
  id: string;
  name: string;
  updatedAt: string;
  createdAt: string;
  preview?: string | null;
};

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (user) {
      loadFiles();
    }
  }, [user]);

  const loadFiles = async () => {
    try {
      const response = await apiClient.getFiles();
      setFiles(response.files);
    } catch (error) {
      console.error("Failed to load files:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFile = async () => {
    try {
      const response = await apiClient.createFile({ name: "Untitled" });
      router.push(`/file/${response.file.id}`);
    } catch (error) {
      console.error("Failed to create file:", error);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center h-dvh bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="flex h-dvh w-full bg-background text-foreground">
      <FileBrowser files={files} onCreateFile={handleCreateFile} />
    </div>
  );
}
