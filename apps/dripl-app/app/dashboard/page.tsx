'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileBrowser } from '@/components/dashboard/FileBrowser';
import { useAuth } from '@/app/context/AuthContext';
import { apiClient, type FileSummary } from '@/lib/api';
import { PageSkeleton } from '@/components/ui/LoadingState';

const PAGE_SIZE = 20;

export default function DashboardPage(): React.ReactNode {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [files, setFiles] = useState<FileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadData = useCallback(async (searchValue: string, pageNum: number) => {
    setLoading(true);
    try {
      const filesResponse = await apiClient.listFiles({
        search: searchValue || undefined,
        page: pageNum,
        limit: PAGE_SIZE,
      });
      setFiles(filesResponse.files);
      setTotal(filesResponse.total);
      setPage(filesResponse.page);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/login');
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

  const handleCreateFile = useCallback(async () => {
    setCreateError(null);
    try {
      const file = await apiClient.createFile({
        name: 'Untitled canvas',
        content: [],
      });
      window.dispatchEvent(new CustomEvent('dripl:files-changed'));
      router.push(`/file/${file.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create canvas';
      setCreateError(message);
    }
  }, [router]);

  const handleOpenLocalCanvas = useCallback(() => {
    router.push('/canvas');
  }, [router]);

  const handleDeleteFile = useCallback(async (id: string) => {
    await apiClient.deleteFile(id);
    setFiles(prev => prev.filter(file => file.id !== id));
    setTotal(prev => Math.max(0, prev - 1));
    window.dispatchEvent(new CustomEvent('dripl:files-changed'));
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
    return <PageSkeleton />;
  }

  if (!user) {
    return null;
  }

  return (
    <div className="flex h-dvh w-full bg-[#F0EDE6]">
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="flex items-center justify-between border-b border-[#E4E0D9] bg-[#FAFAF7] px-6 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-[15px] font-semibold text-[#1A1917]">Your Files</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search files..."
                className="w-56 h-8 rounded-md border border-[#D4D0C9] bg-white px-3 py-1.5 pl-8 text-[13px] text-[#1A1917] placeholder:text-[#9B9890] focus:outline-none focus:border-[#E8462A] transition-colors"
              />
              <svg
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#9B9890]"
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
        </header>
        {createError && (
          <div className="mx-6 mt-4 rounded-md border border-[#F5C2B8] bg-[#FDF2F0] px-3 py-2 text-[13px] text-[#8B2A1A]">
            {createError}
          </div>
        )}
        <FileBrowser
          files={fileItems}
          total={total}
          page={page}
          pageSize={PAGE_SIZE}
          onPageChange={handlePageChange}
          onCreateFile={handleCreateFile}
          onStartNewCanvas={handleCreateFile}
          onOpenLocalCanvas={handleOpenLocalCanvas}
          onDeleteFile={handleDeleteFile}
          onRenameFile={handleRenameFile}
        />
      </div>
    </div>
  );
}
