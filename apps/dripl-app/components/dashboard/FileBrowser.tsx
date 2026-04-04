"use client";

import { useState } from "react";
import {
  File as FileIcon,
  MoreHorizontal,
  Plus,
  Grid3X3,
  List,
  Trash2,
  Pencil,
} from "lucide-react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";

type FileItem = {
  id: string;
  name: string;
  updatedAt: string;
  createdAt: string;
  preview?: string | null;
};

interface FileBrowserProps {
  files: FileItem[];
  onCreateFile?: () => void;
  onStartNewCanvas?: () => void;
  onDeleteFile?: (id: string) => void;
  onRenameFile?: (id: string, name: string) => void;
}

export function FileBrowser({
  files,
  onCreateFile,
  onStartNewCanvas,
  onDeleteFile,
  onRenameFile,
}: FileBrowserProps) {
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const startRename = (file: FileItem) => {
    setEditingId(file.id);
    setEditName(file.name);
    setOpenMenuId(null);
  };

  const commitRename = () => {
    if (editingId && editName.trim()) {
      onRenameFile?.(editingId, editName.trim());
    }
    setEditingId(null);
    setEditName("");
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this canvas?")) {
      onDeleteFile?.(id);
      setOpenMenuId(null);
    }
  };

  return (
    <div className="flex-1 p-8 overflow-auto bg-background">
      <div className="flex items-center justify-between mb-8">
        <div className="flex gap-4">
          <button
            onClick={onStartNewCanvas}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="h-4 w-4" />
            New Canvas
          </button>
          <button
            onClick={onCreateFile}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card text-sm font-medium hover:bg-accent/20 transition-colors"
          >
            <FileIcon className="h-4 w-4" />
            Blank File
          </button>
        </div>
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
          <button
            onClick={() => setViewMode("grid")}
            className={`p-1.5 rounded ${viewMode === "grid" ? "bg-background shadow-sm" : "hover:bg-background/50"}`}
          >
            <Grid3X3 className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`p-1.5 rounded ${viewMode === "list" ? "bg-background shadow-sm" : "hover:bg-background/50"}`}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {files.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <FileIcon className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-2">
            No canvases yet
          </h3>
          <p className="text-sm text-muted-foreground max-w-sm mb-6">
            Create your first canvas to start drawing, designing, and
            collaborating in real-time.
          </p>
          <button
            onClick={onStartNewCanvas}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="h-4 w-4" />
            Create Canvas
          </button>
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {files.map((file) => (
            <Link
              key={file.id}
              href={`/canvas/${file.id}`}
              className="group relative rounded-xl border border-border bg-card hover:border-accent transition-colors overflow-hidden"
            >
              <div className="aspect-[4/3] bg-muted flex items-center justify-center">
                <FileIcon className="h-8 w-8 text-muted-foreground" />
              </div>
              <div className="p-3">
                {editingId === file.id ? (
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="w-full text-sm font-medium bg-background border border-border rounded px-1 py-0.5"
                    autoFocus
                  />
                ) : (
                  <p className="text-sm font-medium text-foreground truncate">
                    {file.name}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {formatDistanceToNow(new Date(file.updatedAt), {
                    addSuffix: true,
                  })}
                </p>
              </div>
              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpenMenuId(openMenuId === file.id ? null : file.id);
                  }}
                  className="p-1 rounded bg-background/80 hover:bg-background"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {openMenuId === file.id && (
                  <div className="absolute right-0 top-8 w-40 bg-popover border border-border rounded-lg shadow-lg py-1 z-10">
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        startRename(file);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Rename
                    </button>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleDelete(file.id);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-destructive hover:bg-accent"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-12 gap-4 px-4 py-2 text-xs font-medium text-muted-foreground border-b border-border">
            <div className="col-span-6">NAME</div>
            <div className="col-span-2">CREATED</div>
            <div className="col-span-2 text-right">EDITED</div>
            <div className="col-span-2"></div>
          </div>
          <div className="divide-y divide-border">
            {files.map((file) => (
              <Link
                key={file.id}
                href={`/canvas/${file.id}`}
                className="grid grid-cols-12 gap-4 px-4 py-3 items-center hover:bg-accent/20 transition-colors group"
              >
                <div className="col-span-6 flex items-center gap-3">
                  <FileIcon className="h-4 w-4 text-muted-foreground" />
                  {editingId === file.id ? (
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="text-sm font-medium bg-background border border-border rounded px-2 py-0.5"
                      autoFocus
                    />
                  ) : (
                    <span className="text-sm text-foreground font-medium group-hover:text-accent-foreground">
                      {file.name}
                    </span>
                  )}
                </div>
                <div className="col-span-2 text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(file.createdAt), {
                    addSuffix: true,
                  })}
                </div>
                <div className="col-span-2 text-xs text-muted-foreground text-right">
                  {formatDistanceToNow(new Date(file.updatedAt), {
                    addSuffix: true,
                  })}
                </div>
                <div className="col-span-2 flex items-center justify-end gap-2">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setOpenMenuId(openMenuId === file.id ? null : file.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-accent rounded"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {openMenuId === file.id && (
                    <div className="absolute right-16 top-12 w-40 bg-popover border border-border rounded-lg shadow-lg py-1 z-10">
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          startRename(file);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Rename
                      </button>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDelete(file.id);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-destructive hover:bg-accent"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
