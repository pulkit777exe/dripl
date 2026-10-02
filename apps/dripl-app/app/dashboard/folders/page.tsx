'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileBrowser } from '@/components/dashboard/FileBrowser';
import { useAuth } from '@/app/context/AuthContext';
import { apiClient, type SharedFileSummary } from '@/lib/api';
import { PageSkeleton } from '@/components/ui/LoadingState';

const PAGE_SIZE = 20;

export default function CollectionsPage(): React.ReactNode {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [files, setFiles] = useState<SharedFileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isCreatingCanvas, setIsCreatingCanvas] = useState(false);
  // Same latch as the dashboard: the button's `disabled` state only lands
  // after React re-renders, so a same-tick second click would create an
  // orphan file. Released in `finally`.
  const createInFlightRef = useRef(false);

  const loadData = useCallback(async (searchValue: string, pageNum: number) => {
    setLoading(true);
    try {
      const response = await apiClient.listSharedFiles({
        search: searchValue || undefined,
        page: pageNum,
        limit: PAGE_SIZE,
      });
      setFiles(response.files);
      setTotal(response.total);
      setPage(response.page);
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
    setActionError(null);
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

  const handleOpenLocalCanvas = useCallback(() => {
    router.push('/canvas');
  }, [router]);

  const handleCreateFile = useCallback(async () => {
    if (createInFlightRef.current) return;
    createInFlightRef.current = true;
    setIsCreatingCanvas(true);
    setActionError(null);
    try {
      const file = await apiClient.createFile({
        name: 'Untitled canvas',
        content: [],
      });
      window.dispatchEvent(new CustomEvent('dripl:files-changed'));
      router.push(`/file/${file.id}`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to create canvas');
    } finally {
      createInFlightRef.current = false;
      setIsCreatingCanvas(false);
    }
  }, [router]);

  // Everything on this page arrives through a `SharedFile` row belonging to
  // the signed-in user, so these are canvases other people own. The API
  // scopes PATCH/DELETE /files/:id to the owner and answers 404 otherwise,
  // which would leave a menu item that silently does nothing. Only the
  // degenerate case where a canvas is shared back to its owner is mutable.
  const ownedFileIds = useMemo(() => {
    const owned = new Set<string>();
    for (const file of files) {
      if (file.userId && file.userId === user?.id) {
        owned.add(file.id);
      }
    }
    return owned;
  }, [files, user?.id]);

  const handleDeleteFile = useCallback(
    async (id: string) => {
      if (!ownedFileIds.has(id)) {
        setActionError('Only the owner can delete a shared canvas.');
        return;
      }
      setActionError(null);
      try {
        await apiClient.deleteFile(id);
        setFiles(prev => prev.filter(file => file.id !== id));
        setTotal(prev => Math.max(0, prev - 1));
        window.dispatchEvent(new CustomEvent('dripl:files-changed'));
      } catch (error) {
        setActionError(error instanceof Error ? error.message : 'Failed to delete canvas');
      }
    },
    [ownedFileIds]
  );

  const handleRenameFile = useCallback(
    async (id: string, name: string) => {
      if (!ownedFileIds.has(id)) {
        setActionError('Only the owner can rename a shared canvas.');
        return;
      }
      setActionError(null);
      try {
        await apiClient.updateFile(id, { name });
        setFiles(prev => prev.map(file => (file.id === id ? { ...file, name } : file)));
      } catch (error) {
        setActionError(error instanceof Error ? error.message : 'Failed to rename canvas');
      }
    },
    [ownedFileIds]
  );

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
        <header className="flex items-center justify-between border-b border-[#E4E0D9] bg-[#FAFAF7] px-6 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-[15px] font-semibold text-[#1A1917]">Shared with You</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search shared files..."
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
        {actionError && (
          <div className="mx-6 mt-4 rounded-md border border-[#F5C2B8] bg-[#FDF2F0] px-3 py-2 text-[13px] text-[#8B2A1A]">
            {actionError}
          </div>
        )}
        <FileBrowser
          files={fileItems}
          total={total}
          page={page}
          pageSize={PAGE_SIZE}
          onPageChange={handlePageChange}
          onStartNewCanvas={handleCreateFile}
          isCreatingCanvas={isCreatingCanvas}
          onOpenLocalCanvas={handleOpenLocalCanvas}
          onDeleteFile={handleDeleteFile}
          onRenameFile={handleRenameFile}
        />
      </div>
    </div>
  );
}
