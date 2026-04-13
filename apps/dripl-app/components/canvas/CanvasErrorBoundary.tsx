'use client';

import React from 'react';

interface CanvasErrorBoundaryProps {
  children: React.ReactNode;
}

interface CanvasErrorBoundaryState {
  hasError: boolean;
}

export class CanvasErrorBoundary extends React.Component<
  CanvasErrorBoundaryProps,
  CanvasErrorBoundaryState
> {
  state: CanvasErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(): CanvasErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Canvas render error', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="relative w-full h-full flex items-center justify-center">
          <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">
            Something went wrong — reload
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
