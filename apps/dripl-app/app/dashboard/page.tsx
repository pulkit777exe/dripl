'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileBrowser } from '@/components/dashboard/FileBrowser';
import { useAuth } from '@/app/context/AuthContext';
import { apiClient, type FileSummary, type FolderSummary } from '@/lib/api';

const PAGE_SIZE = 20;

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [files, setFiles] = useState<FileSummary[]>([]);
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const loadData = useCallback(async (searchValue: string, pageNum: number) => {
    setLoading(true);
    try {
      const [filesResponse, foldersResponse] = await Promise.all([
        apiClient.listFiles({
          search: searchValue || undefined,
          page: pageNum,
          limit: PAGE_SIZE,
        }),
        apiClient.listFolders(),
      ]);
      setFiles(filesResponse.files);
      setTotal(filesResponse.total);
      setPage(filesResponse.page);
      setFolders(foldersResponse.folders);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/auth/login');
      return;
    }
    void loadData('', 1);
  }, [authLoading, loadData, router, user]);

  useEffect(() => {
    if (!user) return;
    const timeout = window.setTimeout(() => {
      void loadData(search.trim(), 1);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [loadData, search, user]);

  const handlePageChange = useCallback(
    (newPage: number) => {
      setPage(newPage);
      void loadData(search.trim(), newPage);
    },
    [loadData, search]
  );

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleCreateFile = useCallback(async () => {
    const file = await apiClient.createFile({ name: 'Untitled file' });
    router.push(`/canvas/${file.id}`);
  }, [router]);

  const handleDeleteFile = useCallback(async (id: string) => {
    await apiClient.deleteFile(id);
    setFiles(prev => prev.filter(file => file.id !== id));
  }, []);

  const handleRenameFile = useCallback(async (id: string, name: string) => {
    await apiClient.updateFile(id, { name });
    setFiles(prev => prev.map(file => (file.id === id ? { ...file, name } : file)));
  }, []);

  const fileItems = useMemo(
    () =>
      files.map(file => ({
        id: file.id,
        name: file.name,
        updatedAt: file.updatedAt,
        createdAt: file.createdAt,
        preview: file.preview,
      })),
    [files]
  );

  if (authLoading || loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="flex h-dvh w-full flex-col bg-background text-foreground">
      <header className="border-b border-border/50 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search files..."
                className="w-64 h-9 rounded-lg border border-border/60 bg-secondary/30 px-4 py-2 pl-9 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:bg-secondary/50 focus:border-primary/30 transition-colors"
              />
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
          </div>
        </div>
      </header>
      <FileBrowser
        files={fileItems}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={handlePageChange}
        onCreateFile={handleCreateFile}
        onStartNewCanvas={handleCreateFile}
        onDeleteFile={handleDeleteFile}
        onRenameFile={handleRenameFile}
      />
    </div>
  );
}
