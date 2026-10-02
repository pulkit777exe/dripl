import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useModalAnimation } from '@/hooks/useModalAnimation';

describe('useModalAnimation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens closed, transitions opening → open on show', () => {
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useModalAnimation(open),
      { initialProps: { open: false } }
    );

    expect(result.current.animState).toBe('closed');
    expect(result.current.isVisible).toBe(false);

    act(() => {
      rerender({ open: true });
    });
    expect(result.current.animState).toBe('open');
    expect(result.current.modalState).toBe('is-open');
    expect(result.current.isVisible).toBe(true);
  });

  it('closes through is-closing and unmounts after the CSS duration', () => {
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useModalAnimation(open),
      { initialProps: { open: true } }
    );
    expect(result.current.animState).toBe('open');

    act(() => {
      rerender({ open: false });
    });
    expect(result.current.animState).toBe('closing');
    expect(result.current.modalState).toBe('is-closing');
    expect(result.current.isVisible).toBe(true);

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.animState).toBe('closed');
    expect(result.current.isVisible).toBe(false);
  });
});
