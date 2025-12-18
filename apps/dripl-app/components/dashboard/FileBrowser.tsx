"use client";

import { File as FileIcon, MoreHorizontal, Plus } from "lucide-react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { useTransition } from "react";
import { handleCreateFile } from "../../app/dashboard/actions";

type File = {
  id: string;
  name: string;
  updatedAt: string;
  createdAt: string;
  preview?: string | null;
};

interface FileBrowserProps {
  files: File[];
}

export function FileBrowser({ files }: FileBrowserProps) {
  const [isPending, startTransition] = useTransition();

  const onCreateFile = () => {
    startTransition(async () => {
      await handleCreateFile();
    });
  };

  return (
    <div className="flex-1 p-8 overflow-auto bg-background">
      <div className="flex gap-4 mb-12">
        <button 
          onClick={onCreateFile}
          disabled={isPending}
          className="flex flex-col items-center justify-center w-48 h-32 rounded-xl border border-border bg-card hover:bg-accent/20 transition-all group disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="h-8 w-8 text-muted-foreground group-hover:text-foreground mb-2 transition-colors" />
          <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground">
            {isPending ? "Creating..." : "Create a Blank File"}
          </span>
        </button>
      </div>

      <div>
        <div className="grid grid-cols-12 gap-4 px-4 py-2 text-xs font-medium text-muted-foreground border-b border-border">
          <div className="col-span-6">NAME</div>
          <div className="col-span-2">LOCATION</div>
          <div className="col-span-2">CREATED</div>
          <div className="col-span-2 text-right">EDITED</div>
        </div>

        <div className="divide-y divide-border">
          {files.map((file) => (
            <Link 
              key={file.id} 
              href={`/file/${file.id}`}
              className="grid grid-cols-12 gap-4 px-4 py-3 items-center hover:bg-accent/20 transition-colors group"
            >
              <div className="col-span-6 flex items-center gap-3">
                <FileIcon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-foreground font-medium group-hover:text-accent-foreground">
                  {file.name}
                </span>
              </div>
              <div className="col-span-2 text-xs text-muted-foreground">—</div>
              <div className="col-span-2 text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(file.createdAt), { addSuffix: true })}
              </div>
              <div className="col-span-2 flex items-center justify-end gap-4">
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(file.updatedAt), { addSuffix: true })}
                </span>
                <button 
                  onClick={(e) => {
                    e.preventDefault();
                    // Add menu logic here
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-accent rounded"
                >
                  <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
            </Link>
          ))}
          
          {files.length === 0 && (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No files yet. Create one to get started.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}