'use client';

import { useState } from 'react';
import {
  File,
  MoreHorizontal,
  Plus,
  Grid3X3,
  List,
  Trash2,
  Pencil,
  Search,
  Filter,
  SlidersHorizontal,
} from 'lucide-react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

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
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
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
    setEditName('');
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this canvas?')) {
      onDeleteFile?.(id);
      setOpenMenuId(null);
    }
  };

  return (
    <div className="flex-1 p-6 overflow-auto bg-background">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold text-foreground">Your Files</h2>
          <span className="text-sm text-muted-foreground">({files.length})</span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-secondary/40 rounded-lg p-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-md transition-all ${
                viewMode === 'grid'
                  ? 'bg-background shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Grid3X3 className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-md transition-all ${
                viewMode === 'list'
                  ? 'bg-background shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <List className="h-4 w-4" />
            </button>
          </div>

          <button className="p-2 rounded-lg bg-secondary/40 text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors">
            <SlidersHorizontal className="h-4 w-4" />
          </button>

          <button
            onClick={onStartNewCanvas}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4" />
            New Canvas
          </button>
        </div>
      </div>

      {files.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <div className="w-24 h-24 rounded-2xl bg-secondary/60 flex items-center justify-center mb-6">
            <File className="h-12 w-12 text-muted-foreground/50" />
          </div>
          <h3 className="text-2xl font-semibold text-foreground mb-2">No files yet</h3>
          <p className="text-muted-foreground max-w-md mb-8">
            Create your first canvas to start drawing, designing, and collaborating in real-time.
          </p>
          <button
            onClick={onStartNewCanvas}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors shadow-md"
          >
            <Plus className="h-5 w-5" />
            Create your first canvas
          </button>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {files.map(file => (
            <Link
              key={file.id}
              href={`/canvas/${file.id}`}
              className="group relative rounded-xl border border-border/60 bg-card hover:border-primary/30 hover:shadow-lg transition-all duration-200"
            >
              <div className="aspect-square bg-secondary/30 flex items-center justify-center rounded-t-xl">
                <File className="h-12 w-12 text-muted-foreground/40" />
              </div>
              <div className="p-3">
                {editingId === file.id ? (
                  <input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    className="w-full text-sm font-medium bg-secondary/40 border border-border rounded-md px-2 py-1"
                    autoFocus
                  />
                ) : (
                  <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {formatDistanceToNow(new Date(file.updatedAt), {
                    addSuffix: true,
                  })}
                </p>
              </div>
              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpenMenuId(openMenuId === file.id ? null : file.id);
                  }}
                  className="p-1.5 rounded-lg bg-background/90 hover:bg-background shadow-sm border border-border/50"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {openMenuId === file.id && (
                  <div className="absolute right-0 top-9 w-36 bg-popover border border-border rounded-xl shadow-xl py-1 z-10">
                    <button
                      onClick={e => {
                        e.preventDefault();
                        e.stopPropagation();
                        startRename(file);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent rounded-lg"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Rename
                    </button>
                    <button
                      onClick={e => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleDelete(file.id);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 rounded-lg"
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
        <div className="bg-card rounded-xl border border-border/60 shadow-sm overflow-hidden">
          <div className="grid grid-cols-12 gap-4 px-5 py-3 text-xs font-medium text-muted-foreground bg-secondary/20 border-b border-border/60">
            <div className="col-span-6">Name</div>
            <div className="col-span-2">Created</div>
            <div className="col-span-2 text-right">Modified</div>
            <div className="col-span-2"></div>
          </div>
          <div className="divide-y divide-border/40">
            {files.map(file => (
              <Link
                key={file.id}
                href={`/canvas/${file.id}`}
                className="grid grid-cols-12 gap-4 px-5 py-3 items-center hover:bg-secondary/30 transition-colors group"
              >
                <div className="col-span-6 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-secondary/50 flex items-center justify-center">
                    <File className="h-4 w-4 text-muted-foreground" />
                  </div>
                  {editingId === file.id ? (
                    <input
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="text-sm font-medium bg-secondary/40 border border-border rounded-md px-2 py-1"
                      autoFocus
                    />
                  ) : (
                    <span className="text-sm font-medium text-foreground">{file.name}</span>
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
                <div className="col-span-2 flex items-center justify-end gap-1">
                  <button
                    onClick={e => {
                      e.preventDefault();
                      e.stopPropagation();
                      setOpenMenuId(openMenuId === file.id ? null : file.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-secondary rounded-lg transition-all"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {openMenuId === file.id && (
                    <div className="absolute right-16 top-12 w-36 bg-popover border border-border rounded-xl shadow-xl py-1 z-10">
                      <button
                        onClick={e => {
                          e.preventDefault();
                          e.stopPropagation();
                          startRename(file);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent rounded-lg"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Rename
                      </button>
                      <button
                        onClick={e => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDelete(file.id);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 rounded-lg"
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
