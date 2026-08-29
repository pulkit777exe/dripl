'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Application error:', error);
  }, [error]);

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center p-4"
      style={{ backgroundColor: 'var(--color-background)' }}
    >
      <div className="text-center">
        <h2 className="mb-4 text-2xl font-semibold text-[#1A1917]">Something went wrong</h2>
        <p className="mb-6 text-[#6B6860]">
          {error.message || 'An unexpected error occurred'}
        </p>
        <button
          onClick={() => reset()}
          className="rounded-md px-4 py-2 text-white transition-colors"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
