import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShareModal } from '@/components/canvas/ShareModal';

function makeFileId() {
  return 'file-1';
}

describe('ShareModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the heading and the permission chooser when open', () => {
    render(
      <ShareModal
        isOpen
        onClose={() => {}}
        fileId={makeFileId()}
        onShareCanvas={vi.fn()}
        onCollaborate={vi.fn()}
      />
    );
    expect(screen.getByRole('heading', { name: /share/i })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: /who can open this link/i })).toBeInTheDocument();
  });

  it('does not render the shareable URL until the user clicks the share button', () => {
    render(
      <ShareModal
        isOpen
        onClose={() => {}}
        fileId={makeFileId()}
        onShareCanvas={vi.fn()}
        onCollaborate={vi.fn()}
      />
    );
    // No URL input is shown before generation.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('switches the underlying permission when the radio changes', async () => {
    const user = userEvent.setup();
    render(
      <ShareModal
        isOpen
        onClose={() => {}}
        fileId={makeFileId()}
        onShareCanvas={vi.fn()}
        onCollaborate={vi.fn()}
      />
    );

    // Default is view.
    expect(screen.getByRole('radio', { name: /view only/i })).toBeChecked();

    // Switch to edit.
    await user.click(screen.getByRole('radio', { name: /can edit/i }));
    expect(screen.getByRole('radio', { name: /can edit/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /view only/i })).not.toBeChecked();
  });

  it('reports the file id on the share action when the user clicks Share', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'tok-abc' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ShareModal
        isOpen
        onClose={() => {}}
        fileId={makeFileId()}
        onShareCanvas={vi.fn()}
        onCollaborate={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /^share$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/share',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ fileId: 'file-1', permission: 'view' }),
        })
      );
    });
  });

  it('sends the new permission when the user changes it before sharing', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'tok-abc' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ShareModal
        isOpen
        onClose={() => {}}
        fileId={makeFileId()}
        onShareCanvas={vi.fn()}
        onCollaborate={vi.fn()}
      />
    );

    await user.click(screen.getByRole('radio', { name: /can edit/i }));
    await user.click(screen.getByRole('button', { name: /^share$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/share',
        expect.objectContaining({
          body: JSON.stringify({ fileId: 'file-1', permission: 'edit' }),
        })
      );
    });
  });

  it('shows the shareable URL after a successful generation', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ token: 'tok-abc' }),
      })
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    render(
      <ShareModal
        isOpen
        onClose={() => {}}
        fileId="file-1"
        onShareCanvas={vi.fn()}
        onCollaborate={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /^share$/i }));

    await waitFor(() => {
      const input = screen.getByRole('textbox') as HTMLInputElement;
      // URL shape (per the hook contract): origin + /share/<fileId> + ?p=<v|e>&t=<token>
      expect(input.value).toMatch(/\/share\/file-1\?p=v&t=tok-abc$/);
    });
  });
});
