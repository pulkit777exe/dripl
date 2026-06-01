import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const addElements = vi.fn();
const setSelectedIds = vi.fn();
const setActiveTool = vi.fn();

vi.mock('@/lib/canvas-store', () => ({
  useCanvasStore: (selector: (state: any) => any) =>
    selector({
      addElements,
      setSelectedIds,
      setActiveTool,
    }),
}));

vi.mock('@/app/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-123' } }),
}));

import { AIGenerateModal } from '@/components/canvas/AIGenerateModal';

describe('AIGenerateModal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          elements: [
            {
              id: 'diagram-1',
              type: 'rectangle',
              x: 100,
              y: 100,
              width: 160,
              height: 90,
            },
          ],
        }),
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('submits AI results into the canvas store and closes after success', async () => {
    const onClose = vi.fn();
    const fetchMock = vi.mocked(globalThis.fetch);

    render(<AIGenerateModal isOpen onClose={onClose} />);
    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    fireEvent.change(screen.getByPlaceholderText(/checkout process/i), {
      target: { value: 'A simple architecture diagram' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate/i }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(addElements).toHaveBeenCalledTimes(1);
    expect(addElements).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'diagram-1',
        type: 'rectangle',
      }),
    ]);
    expect(setSelectedIds).toHaveBeenCalledWith(new Set(['diagram-1']));
    expect(setActiveTool).toHaveBeenCalledWith('select');

    await act(async () => {
      vi.advanceTimersByTime(1200);
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
