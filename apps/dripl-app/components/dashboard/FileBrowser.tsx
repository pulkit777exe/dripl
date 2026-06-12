'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  X,
  AlertTriangle,
} from 'lucide-react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { EmptyFilesState, EmptySearchState } from '@/components/ui/EmptyState';

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
  onOpenLocalCanvas?: () => void;
  onDeleteFile?: (id: string) => void;
  onRenameFile?: (id: string, name: string) => void;
}

function DropdownMenu({ className, children }: { className?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className={`t-dropdown ${open ? 'is-open' : ''} ${className ?? ''}`}>
      {children}
    </div>
  );
}

export function FileBrowser({
  files,
  total = 0,
  page = 1,
  pageSize = 20,
  onPageChange,
  onCreateFile,
  onStartNewCanvas,
  onOpenLocalCanvas,
  onDeleteFile,
  onRenameFile,
}: FileBrowserProps) {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteAnimState, setDeleteAnimState] = useState<'closed' | 'opening' | 'open' | 'closing'>('closed');
  const [localDeleteId, setLocalDeleteId] = useState<string | null>(null);
  const prevDeleteRef = useRef<string | null>(null);
  const closingRef = useRef(false);

  useEffect(() => {
    if (deleteConfirmId && !prevDeleteRef.current && !closingRef.current) {
      prevDeleteRef.current = deleteConfirmId;
      setLocalDeleteId(deleteConfirmId);
      setDeleteAnimState('opening');
    } else if (!deleteConfirmId && prevDeleteRef.current) {
      prevDeleteRef.current = null;
      setDeleteAnimState('closing');
    }
  }, [deleteConfirmId]);

  useEffect(() => {
    if (deleteAnimState === 'opening') {
      const raf = requestAnimationFrame(() => setDeleteAnimState('open'));
      return () => cancelAnimationFrame(raf);
    }
    if (deleteAnimState === 'closing') {
      const ms = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--modal-close-dur')
      ) || 150;
      const timer = setTimeout(() => {
        setDeleteAnimState('closed');
        setLocalDeleteId(null);
        closingRef.current = false;
      }, ms);
      return () => clearTimeout(timer);
    }
  }, [deleteAnimState]);

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
    setDeleteConfirmId(id);
    setOpenMenuId(null);
  };

  const confirmDelete = () => {
    if (localDeleteId) {
      onDeleteFile?.(localDeleteId);
      setDeleteAnimState('closing');
      closingRef.current = true;
    }
  };

  const handleCloseDelete = () => {
    if (deleteAnimState === 'open') {
      setDeleteAnimState('closing');
      closingRef.current = true;
    }
  };

  const deleteModalState = deleteAnimState === 'open' ? 'is-open' : deleteAnimState === 'closing' ? 'is-closing' : '';

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

          <button
            onClick={onOpenLocalCanvas}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#D4D0C9] bg-white text-[#1A1917] text-[13px] font-medium hover:bg-[#E8E5DE] transition-colors"
          >
            Local Canvas
          </button>
        </div>
      </div>

      {files.length === 0 ? (
        <EmptyFilesState onCreateCanvas={onStartNewCanvas} />
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {files.map(file => (
            <Link
              key={file.id}
              href={`/file/${file.id}`}
              className="group relative rounded-lg border border-[#E4E0D9] bg-[#FAFAF7] hover:border-[#D4D0C9] hover:shadow-sm transition-all"
            >
              <div className="aspect-square bg-[#E8E5DE]/40 flex items-center justify-center rounded-t-lg overflow-hidden">
                {file.preview ? (
                  <img
                    src={file.preview}
                    alt={file.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <File className="h-10 w-10 text-[#D4D0C9]" />
                )}
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
                    className="w-full text-[13px] font-medium bg-white border border-[#D4D0C9] rounded-md px-2 py-1 text-[#1A1917] outline-none focus:border-[#E8462A] focus:ring-1 focus:ring-[#E8462A]/20"
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
                  className="p-1.5 rounded-lg bg-[#FAFAF7]/90 hover:bg-[#FAFAF7] shadow-sm border border-[#E4E0D9]/50"
                >
                  <MoreHorizontal className="h-4 w-4" style={{ color: '#6B6860' }} />
                </button>
                {openMenuId === file.id && (
                  <DropdownMenu className="absolute right-0 top-9 w-40 rounded-xl shadow-lg py-1.5 z-50 bg-[#FAFAF7] border border-[#E4E0D9]">
                    <button
                      onClick={e => {
                        e.preventDefault();
                        e.stopPropagation();
                        startRename(file);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors hover:opacity-80 text-[#1A1917]"
                    >
                      <Pencil size={14} className="text-[#6B6860]" />
                      Rename
                    </button>
                    <button
                      onClick={e => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleDelete(file.id);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors hover:opacity-80"
                      style={{ color: '#e03131' }}
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </DropdownMenu>
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
                href={`/file/${file.id}`}
                className="grid grid-cols-12 gap-4 px-5 py-3 items-center hover:bg-secondary/30 transition-colors group"
              >
                <div className="col-span-6 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-secondary/50 flex items-center justify-center overflow-hidden shrink-0">
                    {file.preview ? (
                      <img
                        src={file.preview}
                        alt={file.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <File className="h-4 w-4 text-muted-foreground" />
                    )}
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
                      className="text-sm font-medium bg-white border border-[#D4D0C9] rounded-md px-2 py-1 text-[#1A1917] outline-none focus:border-[#E8462A] focus:ring-1 focus:ring-[#E8462A]/20"
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
                    className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-[#E8E5DE] rounded-lg transition-all"
                  >
                    <MoreHorizontal className="h-4 w-4" style={{ color: '#6B6860' }} />
                  </button>
                  {openMenuId === file.id && (
                    <DropdownMenu className="absolute right-16 top-12 w-40 rounded-xl shadow-lg py-1.5 z-50 bg-[#FAFAF7] border border-[#E4E0D9]">
                      <button
                        onClick={e => {
                          e.preventDefault();
                          e.stopPropagation();
                          startRename(file);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors hover:opacity-80 text-[#1A1917]"
                      >
                        <Pencil size={14} className="text-[#6B6860]" />
                        Rename
                      </button>
                      <button
                        onClick={e => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDelete(file.id);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors hover:opacity-80"
                        style={{ color: '#e03131' }}
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </DropdownMenu>
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

      {deleteAnimState !== 'closed' && typeof document !== 'undefined' && createPortal(
        <div
          className={`fixed inset-0 z-[400] flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm t-modal ${deleteModalState}`}
          onClick={handleCloseDelete}
        >
          <div
            className="w-full max-w-sm rounded-xl shadow-lg overflow-hidden bg-[#FAFAF7] border border-[#E4E0D9]"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#FAE8E5]">
                  <AlertTriangle size={20} className="text-[#e03131]" />
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold text-[#1A1917]">Delete Canvas</h3>
                  <p className="text-[12px] text-[#6B6860]">This action cannot be undone</p>
                </div>
              </div>
              <p className="text-[13px] text-[#6B6860] mb-5">
                Are you sure you want to delete this canvas? This will permanently remove the file and all its content.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={handleCloseDelete}
                  className="px-3 py-1.5 text-[13px] text-[#6B6860] hover:text-[#1A1917] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  className="px-3 py-1.5 bg-[#e03131] text-white text-[13px] font-medium rounded-md hover:bg-[#c2252d] transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
