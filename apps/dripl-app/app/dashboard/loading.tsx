import { Skeleton } from '@/components/ui/LoadingState';

/**
 * The streamed fallback for `/dashboard`.
 *
 * `app/dashboard/page.tsx` is a Server Component that awaits the file list, so
 * this is what the browser paints at TTFB while that resolves. That makes it
 * load-bearing rather than decorative: if its geometry does not match
 * `components/dashboard/DashboardFiles.tsx`, every dashboard visit grows a
 * layout shift at exactly the moment it was supposed to feel instant.
 *
 * So the shapes here are copied from the real page rather than invented:
 * the same full-height flex column, the same bordered top bar with a heading
 * placeholder and a search-field-sized placeholder, and the same
 * `FileBrowser` grid — `flex-1 p-6`, the "All Files" row, then six
 * `aspect-square` tiles per row at the same breakpoints. The tile count is 12
 * because that is what the list view renders first, and a fallback shorter than
 * the content would still shift the scroll extent.
 */
export default function DashboardLoading() {
  return (
    <div className="flex h-dvh w-full bg-[#F0EDE6]">
      <div className="flex-1 flex flex-col min-w-0">
        {/* Same top bar the page renders. */}
        <header className="flex items-center justify-between border-b border-[#E4E0D9] bg-[#FAFAF7] px-6 py-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-56" />
        </header>

        {/* Same container, heading row and grid the page renders. */}
        <div className="flex-1 p-6 overflow-auto bg-[#F0EDE6]">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {[...Array(12)].map((_, i) => (
              <div
                key={i}
                className="rounded-lg border border-[#E4E0D9] bg-[#FAFAF7] overflow-hidden"
              >
                <Skeleton className="aspect-square w-full" />
                <div className="p-3 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
