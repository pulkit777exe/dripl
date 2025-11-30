"use client";

import { File as FileIcon, MoreHorizontal, Plus } from "lucide-react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";

// Mock data type for now, will replace with Prisma type later
type File = {
  id: string;
  name: string;
  updatedAt: Date;
  createdAt: Date;
  preview?: string | null;
};

interface FileBrowserProps {
  files: File[];
  onCreateFile: () => void;
}

export function FileBrowser({ files, onCreateFile }: FileBrowserProps) {
  return (
    <div className="flex-1 p-8 overflow-auto bg-zinc-950">
      <div className="flex gap-4 mb-12">
        <button 
          onClick={onCreateFile}
          className="flex flex-col items-center justify-center w-48 h-32 rounded-xl border border-white/10 bg-zinc-900/50 hover:bg-zinc-900 transition-all group"
        >
          <Plus className="h-8 w-8 text-zinc-400 group-hover:text-white mb-2 transition-colors" />
          <span className="text-sm font-medium text-zinc-400 group-hover:text-white">Create a Blank File</span>
        </button>
        {/* Add AI generation buttons if needed later */}
      </div>

      <div>
        <div className="grid grid-cols-12 gap-4 px-4 py-2 text-xs font-medium text-zinc-500 border-b border-white/10">
          <div className="col-span-6">NAME</div>
          <div className="col-span-2">LOCATION</div>
          <div className="col-span-2">CREATED</div>
          <div className="col-span-2 text-right">EDITED</div>
        </div>

        <div className="divide-y divide-white/5">
          {files.map((file) => (
            <Link 
              key={file.id} 
              href={`/file/${file.id}`}
              className="grid grid-cols-12 gap-4 px-4 py-3 items-center hover:bg-zinc-900/50 transition-colors group"
            >
              <div className="col-span-6 flex items-center gap-3">
                <FileIcon className="h-4 w-4 text-zinc-400" />
                <span className="text-sm text-zinc-300 font-medium group-hover:text-white">{file.name}</span>
              </div>
              <div className="col-span-2 text-xs text-zinc-500">—</div>
              <div className="col-span-2 text-xs text-zinc-500">
                {formatDistanceToNow(file.createdAt, { addSuffix: true })}
              </div>
              <div className="col-span-2 flex items-center justify-end gap-4">
                <span className="text-xs text-zinc-500">
                  {formatDistanceToNow(file.updatedAt, { addSuffix: true })}
                </span>
                <button className="opacity-0 group-hover:opacity-100 p-1 hover:bg-zinc-800 rounded">
                  <MoreHorizontal className="h-4 w-4 text-zinc-400" />
                </button>
              </div>
            </Link>
          ))}
          
          {files.length === 0 && (
            <div className="py-12 text-center text-zinc-500 text-sm">
              No files yet. Create one to get started.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
