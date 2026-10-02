import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShareModal } from '@/components/canvas/ShareModal';
import { apiClient } from '@/lib/api';

function makeFileId() {
  return 'file-1';
}

function mockShareResponse(url = 'https://dripl.test/share/tok-abc#key=server-key') {
  return vi.spyOn(apiClient, 'shareFile').mockResolvedValue({
    token: 'tok-abc',
    permission: 'view',
    expiresAt: null,
    shareUrl: url,
  });
}

describe('ShareModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

    expect(screen.getByRole('radio', { name: /view only/i })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: /can edit/i }));
    expect(screen.getByRole('radio', { name: /can edit/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /view only/i })).not.toBeChecked();
  });

  it('reports the file id and default permission to the owner-scoped share API', async () => {
    const user = userEvent.setup();
    const shareFile = mockShareResponse();

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
    await waitFor(() => expect(shareFile).toHaveBeenCalledWith('file-1', { permission: 'view' }));
  });

  it('sends the new permission when the user changes it before sharing', async () => {
    const user = userEvent.setup();
    const shareFile = mockShareResponse('https://dripl.test/share/tok-edit#key=server-key');

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
    await waitFor(() => expect(shareFile).toHaveBeenCalledWith('file-1', { permission: 'edit' }));
  });

  it('shows the durable URL returned by the share service', async () => {
    const user = userEvent.setup();
    mockShareResponse();
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
      const input = screen.getByRole('textbox', { name: /shareable link/i }) as HTMLInputElement;
      expect(input.value).toBe('https://dripl.test/share/tok-abc#key=server-key');
    });
  });
});
