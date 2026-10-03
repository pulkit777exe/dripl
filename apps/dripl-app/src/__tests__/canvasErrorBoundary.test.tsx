import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as common from '@dripl/common';
import { CanvasErrorBoundary } from '@/components/canvas/CanvasErrorBoundary';

function Boom({ throws = true }: { throws?: boolean }) {
  if (throws) throw new Error('render exploded');
  return <div>healthy child</div>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CanvasErrorBoundary', () => {
  it('renders its children while nothing throws', () => {
    render(
      <CanvasErrorBoundary name="StaticCanvas">
        <Boom throws={false} />
      </CanvasErrorBoundary>
    );
    expect(screen.getByText('healthy child')).toBeInTheDocument();
  });

  it('swallows a render error so one broken layer cannot blank the canvas', () => {
    vi.spyOn(common, 'logError').mockImplementation(() => undefined);
    // React logs the caught error itself; silence it so the run stays readable.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { container } = render(
      <CanvasErrorBoundary name="InteractiveCanvas">
        <Boom />
      </CanvasErrorBoundary>
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('healthy child')).not.toBeInTheDocument();
  });

  it('reports the error with the layer name through the logging boundary', () => {
    const logError = vi.spyOn(common, 'logError').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error('render exploded');

    function Thrower(): React.ReactNode {
      throw error;
    }

    render(
      <CanvasErrorBoundary name="StaticCanvas">
        <Thrower />
      </CanvasErrorBoundary>
    );

    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith('[StaticCanvas] render error:', error);
  });

  it('renders the supplied fallback instead of the children', () => {
    vi.spyOn(common, 'logError').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <CanvasErrorBoundary name="RoughCanvas" fallback={<p>canvas unavailable</p>}>
        <Boom />
      </CanvasErrorBoundary>
    );

    expect(screen.getByText('canvas unavailable')).toBeInTheDocument();
  });

  it('recovers nothing after the first failure — the subtree stays unmounted', () => {
    vi.spyOn(common, 'logError').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { rerender } = render(
      <CanvasErrorBoundary name="RoughCanvas">
        <Boom />
      </CanvasErrorBoundary>
    );

    rerender(
      <CanvasErrorBoundary name="RoughCanvas">
        <Boom throws={false} />
      </CanvasErrorBoundary>
    );

    // Re-rendering the parent does not reset hasError, so the healthy child
    // stays hidden until the boundary itself unmounts. That is the intended
    // behaviour for a canvas layer: remount instead of half-restoring.
    expect(screen.queryByText('healthy child')).not.toBeInTheDocument();
  });
});
