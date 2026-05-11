import { cn } from '@/lib/utils';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-[#E8E5DE]', className)}
      {...props}
    />
  );
}

interface LoadingStateProps {
  message?: string;
  className?: string;
}

export function LoadingState({ message = 'Loading...', className }: LoadingStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-20', className)}>
      <div className="w-8 h-8 mb-4 relative">
        <div className="absolute inset-0 border-2 border-[#E8462A]/20 rounded-full" />
        <div className="absolute inset-0 border-2 border-[#E8462A] rounded-full border-t-transparent animate-spin" />
      </div>
      <p className="text-[13px] text-[#6B6860]">{message}</p>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="flex h-dvh w-full bg-[#F0EDE6]">
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header skeleton */}
        <div className="flex items-center justify-between border-b border-[#E4E0D9] bg-[#FAFAF7] px-6 py-3">
          <Skeleton className="h-5 w-32" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-48" />
          </div>
        </div>

        {/* Content skeleton */}
        <div className="flex-1 p-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {[...Array(12)].map((_, i) => (
              <div key={i} className="rounded-lg border border-[#E4E0D9] bg-[#FAFAF7] overflow-hidden">
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

export function CardSkeleton() {
  return (
    <div className="rounded-lg border border-[#E4E0D9] bg-[#FAFAF7] overflow-hidden">
      <Skeleton className="aspect-square w-full" />
      <div className="p-3 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

export function FormSkeleton() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-10 w-full" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-10 w-full" />
      </div>
      <Skeleton className="h-10 w-full" />
    </div>
  );
}