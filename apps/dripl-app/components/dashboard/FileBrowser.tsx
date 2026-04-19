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
  ChevronLeft,
  ChevronRight,
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
  total?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  onCreateFile?: () => void;
  onStartNewCanvas?: () => void;
  onDeleteFile?: (id: string) => void;
  onRenameFile?: (id: string, name: string) => void;
}

export function FileBrowser({
  files,
  total = 0,
  page = 1,
  pageSize = 20,
  onPageChange,
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
    <div className="flex-1 p-6 overflow-auto bg-[#F0EDE6]">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h2 className="text-[15px] font-semibold text-[#1A1917]">All Files</h2>
          <span className="text-[12px] text-[#9B9890]">({files.length})</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-md border border-[#D4D0C9] bg-white p-0.5">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded transition-all ${
                viewMode === 'grid'
                  ? 'bg-[#E8E5DE] text-[#1A1917]'
                  : 'text-[#9B9890] hover:text-[#1A1917]'
              }`}
            >
              <Grid3X3 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded transition-all ${
                viewMode === 'list'
                  ? 'bg-[#E8E5DE] text-[#1A1917]'
                  : 'text-[#9B9890] hover:text-[#1A1917]'
              }`}
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>

          <button className="p-1.5 rounded-md border border-[#D4D0C9] bg-white text-[#9B9890] hover:text-[#1A1917] hover:bg-[#E8E5DE] transition-colors">
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </button>

          <button
            onClick={onStartNewCanvas}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#E8462A] text-white text-[13px] font-medium hover:bg-[#D93D22] transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            New Canvas
          </button>
        </div>
      </div>

      {files.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-28 text-center">
          <div className="w-32 h-32 mb-6 opacity-20">
            <svg viewBox="0 0 120 120" fill="none" className="w-full h-full">
              <rect x="20" y="10" width="80" height="100" rx="8" stroke="#9B9890" strokeWidth="2" />
              <path
                d="M60 10v60l25-25"
                stroke="#9B9890"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M60 70L35 45"
                stroke="#9B9890"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h3 className="text-[15px] font-semibold text-[#1A1917] mb-1">No files yet</h3>
          <p className="text-[13px] text-[#9B9890] max-w-xs mb-6">
            Create your first canvas and it will show up here.
          </p>
          <button
            onClick={onStartNewCanvas}
            className="flex items-center gap-1.5 px-4 py-2 rounded-md border border-[#D4D0C9] bg-white text-[13px] font-medium text-[#1A1917] hover:bg-[#E8E5DE] transition-colors"
          >
            Add canvas
          </button>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {files.map(file => (
            <Link
              key={file.id}
              href={`/canvas/${file.id}`}
              className="group relative rounded-lg border border-[#E4E0D9] bg-[#FAFAF7] hover:border-[#D4D0C9] hover:shadow-sm transition-all"
            >
              <div className="aspect-square bg-[#E8E5DE]/40 flex items-center justify-center rounded-t-lg">
                <File className="h-10 w-10 text-[#D4D0C9]" />
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
                  <p className="text-[13px] font-medium text-[#1A1917] truncate">{file.name}</p>
                )}
                <p className="text-[11px] text-[#9B9890] mt-0.5">
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

      {total > pageSize && (
        <div className="flex items-center justify-center gap-2 py-6 border-t border-border/40">
          <button
            onClick={() => onPageChange?.(page - 1)}
            disabled={page <= 1}
            className="p-2 rounded-lg border border-border/60 hover:bg-secondary/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {Math.ceil(total / pageSize)}
          </span>
          <button
            onClick={() => onPageChange?.(page + 1)}
            disabled={page >= Math.ceil(total / pageSize)}
            className="p-2 rounded-lg border border-border/60 hover:bg-secondary/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
