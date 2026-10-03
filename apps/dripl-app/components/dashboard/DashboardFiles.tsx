'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileBrowser } from '@/components/dashboard/FileBrowser';
import { apiClient, type FileSummary } from '@/lib/api';

const PAGE_SIZE = 20;

export type DashboardInitialFiles = {
  files: FileSummary[];
  total: number;
  page: number;
  limit: number;
};

type DashboardFilesProps = {
  /**
   * Page 1 of the user's files, fetched on the server by `app/dashboard/page.tsx`
   * and rendered into the HTML. This component owns the list from here on.
   */
  initial: DashboardInitialFiles;
};

/**
 * The dashboard list, hydrated from a server fetch.
 *
 * What changed and why it was measured rather than assumed:
 *
 * The list used to be fetched from `useEffect`, behind a `PageSkeleton` that
 * replaced the whole page. Four round trips stood between the document and the
 * first canvas tile: HTML, then the JS bundle, then `/auth/me`, then
 * `/files`. Worse, the initial page was fetched **twice** — once from the
 * "load page 1" effect and again from the search-debounce effect, which fired
 * on mount with an empty query because it depends on `user` rather than on the
 * query having changed. `seededRef` below is that second request, deleted.
 *
 * Search and pagination still fetch, because the server only ever rendered page
 * one; but they are now the only things that fetch, they skip the query the
 * server already answered, and they render into a list that is already on
 * screen rather than replacing the page with a skeleton.
 */
export function DashboardFiles({ initial }: DashboardFilesProps) {
  const router = useRouter();
  const [files, setFiles] = useState<FileSummary[]>(initial.files);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(initial.total);
  const [page, setPage] = useState(initial.page);
  // One banner for every action this page can fail at (create, delete,
  // rename), so a rejected mutation is never silent.
  const [actionError, setActionError] = useState<string | null>(null);
  const [isCreatingCanvas, setIsCreatingCanvas] = useState(false);
  // The button's `disabled` state only lands after React re-renders, so the
  // same tick could still deliver a second click. This latch closes that
  // window; `handleCreateFile` releases it in `finally`.
  const createInFlightRef = useRef(false);
  // True once a client-side query has replaced the server's page one. Before
  // that, the props *are* the current result and re-fetching them would be the
  // duplicate request described above.
  const seededRef = useRef(false);

  const loadData = useCallback(async (searchValue: string, pageNum: number) => {
    const filesResponse = await apiClient.listFiles({
      search: searchValue || undefined,
      page: pageNum,
      limit: PAGE_SIZE,
    });
    setFiles(filesResponse.files);
    setTotal(filesResponse.total);
    setPage(filesResponse.page);
  }, []);

  // Search only. Unlike the original this does not depend on `user`, so it does
  // not fire once for "the user arrived" and again for "the user typed".
  useEffect(() => {
    if (!seededRef.current) {
      seededRef.current = true;
      return;
    }
    const timeout = window.setTimeout(() => {
      void loadData(search.trim(), 1);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [loadData, search]);

  const handlePageChange = useCallback(
    (newPage: number) => {
      setPage(newPage);
      void loadData(search.trim(), newPage);
    },
    [loadData, search]
  );

  const handleCreateFile = useCallback(async () => {
    // A second click before the first request settles would create an orphan
    // file: both requests resolve, but only the first `router.push` navigates.
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
      const message = error instanceof Error ? error.message : 'Failed to create canvas';
      setActionError(message);
    } finally {
      createInFlightRef.current = false;
      setIsCreatingCanvas(false);
    }
  }, [router]);

  const handleOpenLocalCanvas = useCallback(() => {
    router.push('/canvas');
  }, [router]);

  // `FileBrowser` invokes these without awaiting, so an uncaught rejection
  // would surface as an unhandled promise rejection with no user feedback and
  // no list update. Each handler absorbs its own failure into `actionError`.
  const handleDeleteFile = useCallback(async (id: string) => {
    setActionError(null);
    try {
      await apiClient.deleteFile(id);
      setFiles(prev => prev.filter(file => file.id !== id));
      setTotal(prev => Math.max(0, prev - 1));
      window.dispatchEvent(new CustomEvent('dripl:files-changed'));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to delete canvas');
    }
  }, []);

  const handleRenameFile = useCallback(async (id: string, name: string) => {
    setActionError(null);
    try {
      await apiClient.updateFile(id, { name });
      setFiles(prev => prev.map(file => (file.id === id ? { ...file, name } : file)));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to rename canvas');
    }
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
