"use client";

import { Search, MoreHorizontal, File, Plus } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";

interface FileData {
  id: string;
  name: string;
  updatedAt: string;
  createdAt: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: files, isLoading } = useQuery<FileData[]>({
    queryKey: ["files"],
    queryFn: async () => {
      const res = await fetch("/api/files");
      if (!res.ok) throw new Error("Failed to fetch files");
      return res.json();
    },
  });

  const createFile = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch("/api/files", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("Failed to create file");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["files"] });
      router.push(`/canvas?fileId=${data.id}`);
    },
  });

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">All Files</h1>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input 
              type="text" 
              placeholder="Search files..." 
              className="pl-9 pr-4 py-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <button 
          onClick={() => createFile.mutate("Untitled File")}
          disabled={createFile.isPending}
          className="flex flex-col items-center justify-center gap-3 p-6 rounded-xl border bg-card hover:bg-accent/50 transition-colors group"
        >
          <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center group-hover:bg-background transition-colors">
            <Plus className="w-5 h-5" />
          </div>
          <span className="font-medium text-sm">Create a Blank File</span>
        </button>
        {/* Placeholders for AI features */}
        {['Generate AI Diagram', 'Generate AI Outline'].map((action, i) => (
          <button 
            key={i}
            className="flex flex-col items-center justify-center gap-3 p-6 rounded-xl border bg-card hover:bg-accent/50 transition-colors group opacity-50 cursor-not-allowed"
          >
            <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center group-hover:bg-background transition-colors">
              <File className="w-5 h-5" />
            </div>
            <span className="font-medium text-sm">{action} (Coming Soon)</span>
          </button>
        ))}
      </div>

      {/* File List */}
      <div className="rounded-xl border bg-card">
        <div className="grid grid-cols-12 gap-4 p-4 border-b text-xs font-medium text-muted-foreground uppercase tracking-wider">
          <div className="col-span-6">Name</div>
          <div className="col-span-2">Location</div>
          <div className="col-span-2">Created</div>
          <div className="col-span-1">Edited</div>
          <div className="col-span-1 text-right">Actions</div>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Loading files...</div>
        ) : files?.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">No files found. Create one to get started.</div>
        ) : (
          files?.map((file) => (
            <Link 
              key={file.id}
              href={`/canvas?fileId=${file.id}`}
              className="grid grid-cols-12 gap-4 p-4 items-center hover:bg-accent/50 transition-colors border-b last:border-0"
            >
              <div className="col-span-6 flex items-center gap-3">
                <div className="w-8 h-8 rounded bg-indigo-500/10 flex items-center justify-center text-indigo-500">
                  <File className="w-4 h-4" />
                </div>
                <span className="font-medium">{file.name}</span>
              </div>
              <div className="col-span-2 text-sm text-muted-foreground">—</div>
              <div className="col-span-2 text-sm text-muted-foreground">
                {formatDistanceToNow(new Date(file.createdAt), { addSuffix: true })}
              </div>
              <div className="col-span-1 text-sm text-muted-foreground">
                {formatDistanceToNow(new Date(file.updatedAt), { addSuffix: true })}
              </div>
              <div className="col-span-1 flex justify-end">
                <button className="p-2 hover:bg-background rounded-md transition-colors" onClick={(e) => {
                  e.preventDefault();
                  // Add delete logic here
                }}>
                  <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
