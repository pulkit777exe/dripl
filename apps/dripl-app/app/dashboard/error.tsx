"use client";

import { useEffect } from "react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-foreground mb-2">
          Something went wrong!
        </h2>
        <p className="text-muted-foreground mb-4">{error.message}</p>
        <button
          onClick={reset}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}