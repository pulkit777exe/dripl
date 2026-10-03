import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasStore } from '@/lib/store';
import { TopBar } from '@/components/canvas/TopBar';
import type { DriplElement } from '@dripl/common';

const auth = vi.hoisted(() => ({ user: null as { name?: string } | null }));
const router = vi.hoisted(() => ({ push: vi.fn() }));
const fileOps = vi.hoisted(() => ({
  handleResetCanvas: vi.fn(),
  handleSaveToFile: vi.fn(),
  handleOpenFile: vi.fn(),
  handleExportImage: vi.fn(),
}));

vi.mock('@/app/context/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/hooks/useTopBarFileOps', () => ({ useTopBarFileOps: () => fileOps }));
vi.mock('@/components/canvas/Menu', () => ({
  Menu: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="menu">
        <button onClick={onClose}>close menu</button>
      </div>
    ) : null,
}));
vi.mock('@/components/canvas/ShareModal', () => ({
  ShareModal: ({
    isOpen,
    onShareCanvas,
    onCollaborate,
    feedbackMessage,
    errorMessage,
  }: {
    isOpen: boolean;
    onShareCanvas: () => void;
    onCollaborate: () => void;
    feedbackMessage: string | null;
    errorMessage: string | null;
  }) =>
    isOpen ? (
      <div data-testid="share-modal">
        <button onClick={onShareCanvas}>share</button>
        <button onClick={onCollaborate}>collab</button>
        {feedbackMessage ? <p>{feedbackMessage}</p> : null}
        {errorMessage ? <p>{errorMessage}</p> : null}
      </div>
    ) : null,
}));

function rect(id: string): DriplElement {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    strokeColor: '#000000',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    version: 1,
    versionNonce: 1,
  } as DriplElement;
}

function seed(elements: DriplElement[] = []) {
  useCanvasStore.setState({
    elements: [],
    elementsById: new Map(),
    selectedIds: new Set<string>(),
    isConnected: false,
    roomId: null,
    remoteUsers: new Map(),
    shouldLeaveRoom: false,
    past: [],
    future: [],
    spatialVersion: 0,
    spatialChangedIds: [],
    spatialChangedIdsVersion: 0,
  });
  useCanvasStore.getState().setElements(elements, { skipHistory: true });
}

function stubClipboard() {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return writeText;
}

beforeEach(() => {
  auth.user = null;
  router.push.mockClear();
  fileOps.handleResetCanvas.mockClear();
  fileOps.handleSaveToFile.mockClear();
  fileOps.handleOpenFile.mockClear();
  fileOps.handleExportImage.mockClear();
  localStorage.clear();
  document.documentElement.lang = '';
  seed();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('TopBar chrome', () => {
  it('toggles the settings menu and lets it close itself', () => {
    render(<TopBar />);
    expect(screen.queryByTestId('menu')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open settings and options' }));
    expect(screen.getByTestId('menu')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'close menu' }));
    expect(screen.queryByTestId('menu')).not.toBeInTheDocument();
  });

  it('opens and closes the share modal', () => {
    render(<TopBar />);
    expect(screen.queryByTestId('share-modal')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.getByTestId('share-modal')).toBeInTheDocument();
  });

  it('sends an anonymous visitor to login from the upgrade button', () => {
    render(<TopBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Dripl plus' }));
    expect(router.push).toHaveBeenCalledWith('/login?next=/settings/plan');
  });

  it('sends a signed-in user straight to the plan', () => {
    auth.user = { name: 'Ada' };
    render(<TopBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Dripl plus' }));
    expect(router.push).toHaveBeenCalledWith('/settings/plan');
  });

  it('restores the stored language onto the document', () => {
    localStorage.setItem('dripl-language', 'ja');
    render(<TopBar />);
    expect(document.documentElement.lang).toBe('ja');
  });

  it('defaults the language to English when nothing is stored', () => {
    render(<TopBar />);
    expect(document.documentElement.lang).toBe('en');
  });
});

describe('TopBar keyboard shortcuts', () => {
  it('routes the file shortcuts through the file-ops hook', () => {
    render(<TopBar />);

    fireEvent.keyDown(window, { key: 'o', ctrlKey: true });
    expect(fileOps.handleOpenFile).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(fileOps.handleSaveToFile).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'E', ctrlKey: true, shiftKey: true });
    expect(fileOps.handleExportImage).toHaveBeenCalledTimes(1);
  });

  it('opens the command palette on Ctrl+/', () => {
    render(<TopBar />);
    const onOpen = vi.fn();
    window.addEventListener('dripl:open-command-palette', onOpen);

    fireEvent.keyDown(window, { key: '/', ctrlKey: true });

    expect(onOpen).toHaveBeenCalledTimes(1);
    window.removeEventListener('dripl:open-command-palette', onOpen);
  });

  it('ignores the shortcuts while typing in a field', () => {
    render(<TopBar />);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, { key: 'o', ctrlKey: true });

    expect(fileOps.handleOpenFile).not.toHaveBeenCalled();
    input.remove();
  });

  it('removes its key listener on unmount', () => {
    const { unmount } = render(<TopBar />);
    unmount();
    fileOps.handleOpenFile.mockClear();

    fireEvent.keyDown(window, { key: 'o', ctrlKey: true });
    expect(fileOps.handleOpenFile).not.toHaveBeenCalled();
  });
});

describe('TopBar sharing', () => {
  it('refuses to share an empty canvas and says why', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<TopBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'share' }));
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText(/Nothing to share yet/)).toBeInTheDocument();
    });
  });

  it('creates a snapshot and copies the link', async () => {
    seed([rect('a')]);
    const writeText = stubClipboard();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'snap-1' }),
    } as Response);
    render(<TopBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'share' }));
    });

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/canvas?snapshot=snap-1`);
    });
    expect(screen.getByText('Link copied!')).toBeInTheDocument();
  });

  it('reports a failed snapshot through the logging boundary', async () => {
    seed([rect('a')]);
    stubClipboard();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500 } as Response);
    render(<TopBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'share' }));
    });

    await waitFor(() => {
      expect(screen.getByText(/Failed to create share link/)).toBeInTheDocument();
    });
  });

  it('creates a room and navigates to it', async () => {
    seed([rect('a')]);
    stubClipboard();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ roomId: 'room-7' }),
    } as Response);
    render(<TopBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'collab' }));
    });

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith('/room/room-7');
    });
    // A successful start closes the modal.
    expect(screen.queryByTestId('share-modal')).not.toBeInTheDocument();
  });

  it('sends an unauthorised user to login with the current location', async () => {
    seed([rect('a')]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 401 } as Response);
    render(<TopBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'collab' }));
    });

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(
        `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`
      );
    });
  });

  it('reports a failed room creation', async () => {
    seed([rect('a')]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500 } as Response);
    render(<TopBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'collab' }));
    });

    await waitFor(() => {
      expect(screen.getByText(/Failed to start collaboration/)).toBeInTheDocument();
    });
  });
});
