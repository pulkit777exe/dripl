import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const addElements = vi.fn();
const setSelectedIds = vi.fn();
const setActiveTool = vi.fn();
const setAiGenerating = vi.fn();
let aiGenerating = false;

vi.mock('@/lib/store', () => ({
  useCanvasStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        addElements,
        setSelectedIds,
        setActiveTool,
        aiGenerating,
        setAiGenerating,
        readOnly: false,
      }),
    { getState: () => ({ readOnly: false }) }
  ),
}));

vi.mock('@/app/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-123' } }),
}));

import { AIGenerateModal } from '@/components/canvas/AIGenerateModal';

const VALID_ELEMENT = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  type: 'rectangle' as const,
  x: 100,
  y: 100,
  width: 160,
  height: 90,
};

function submitPrompt(value = 'A simple architecture diagram') {
  fireEvent.change(screen.getByPlaceholderText(/checkout process/i), {
    target: { value },
  });
  fireEvent.click(screen.getByRole('button', { name: /generate/i }));
}

describe('AIGenerateModal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    aiGenerating = false;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ elements: [VALID_ELEMENT] }),
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('exposes an accessible dialog and bounds the prompt input', async () => {
    render(<AIGenerateModal isOpen onClose={vi.fn()} />);
    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(screen.getByRole('dialog', { name: /AI Diagram Generator/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/checkout process/i)).toHaveAttribute('maxLength', '2000');
  });

  it('submits AI results into the canvas store and closes after success', async () => {
    const onClose = vi.fn();
    const fetchMock = vi.mocked(globalThis.fetch);
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    render(<AIGenerateModal isOpen onClose={onClose} />);
    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    await act(async () => {
      submitPrompt();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]?.[1];
    expect(request?.credentials).toBe('include');
    expect(JSON.parse(String(request?.body))).toEqual({ prompt: 'A simple architecture diagram' });
    expect(addElements).toHaveBeenCalledWith([expect.objectContaining(VALID_ELEMENT)]);
    expect(setSelectedIds).toHaveBeenCalledWith(new Set([VALID_ELEMENT.id]));
    expect(setActiveTool).toHaveBeenCalledWith('select');
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'dripl:fit-elements' })
    );

    await act(async () => {
      vi.advanceTimersByTime(1200);
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows a sign-in message for an expired or missing session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: 'Sign in to use AI diagram generation',
          code: 'AUTH_REQUIRED',
        }),
      })
    );

    render(<AIGenerateModal isOpen onClose={vi.fn()} />);
    await act(async () => {
      vi.runOnlyPendingTimers();
    });
    await act(async () => {
      submitPrompt();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/sign in/i);
    expect(addElements).not.toHaveBeenCalled();
  });

  it('shows a useful error when a successful response has no valid elements', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ elements: [{ id: 'not-an-element' }] }),
      })
    );

    render(<AIGenerateModal isOpen onClose={vi.fn()} />);
    await act(async () => {
      vi.runOnlyPendingTimers();
    });
    await act(async () => {
      submitPrompt();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/unusable|try again|invalid/i);
    expect(addElements).not.toHaveBeenCalled();
  });

  it('does not show a raw JSON parsing exception for a non-JSON upstream response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
      })
    );

    render(<AIGenerateModal isOpen onClose={vi.fn()} />);
    await act(async () => {
      vi.runOnlyPendingTimers();
    });
    await act(async () => {
      submitPrompt();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('alert')).not.toHaveTextContent(/Unexpected token/i);
  });
});
