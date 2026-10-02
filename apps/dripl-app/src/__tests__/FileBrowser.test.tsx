import type { ComponentProps } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { FileBrowser } from '@/components/dashboard/FileBrowser';

type FileBrowserProps = ComponentProps<typeof FileBrowser>;

const FILES = [
  {
    id: 'file-1',
    name: 'Alpha canvas',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
  {
    id: 'file-2',
    name: 'Beta canvas',
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-03T00:00:00.000Z',
  },
];

function renderBrowser(props: Partial<FileBrowserProps> = {}) {
  return render(<FileBrowser files={FILES} {...props} />);
}

/**
 * Each file is a `next/link` row, so the row is reachable by role+name even
 * when the row holds no controls of its own.
 */
function rowLink(name: string): HTMLElement {
  return screen.getByRole('link', { name: new RegExp(name, 'i') });
}

/**
 * The row's action trigger is an icon-only button (a `MoreHorizontal` glyph
 * with no text and no `aria-label`), so it is addressed by its position inside
 * the row rather than by an accessible name. A correctly gated row has none.
 */
function rowActionButtons(name: string): HTMLElement[] {
  return within(rowLink(name)).queryAllByRole('button');
}

function rowActionButton(name: string): HTMLElement {
  const [first] = rowActionButtons(name);
  if (!first) throw new Error(`row "${name}" rendered no action button`);
  return first;
}

/**
 * The pager's chevrons are icon-only too, so they are addressed through the
 * container they share with the page indicator: 0 is previous, 1 is next.
 */
function pagerButton(index: 0 | 1): HTMLElement {
  const [indicator] = screen.queryAllByText(/page \d+ of \d+/i);
  const pager = indicator?.parentElement;
  if (!pager) throw new Error('pager container not found');
  const [button] = within(pager).queryAllByRole('button').slice(index);
  if (!button) throw new Error(`pager button ${index} not found`);
  return button;
}

async function switchView(user: UserEvent, toggle: RegExp): Promise<void> {
  await user.click(screen.getByRole('button', { name: toggle }));
}

async function openRowMenu(user: UserEvent, name: string): Promise<void> {
  await user.click(rowActionButton(name));
}

/**
 * The confirmation is a portal whose root carries `is-open` only once its
 * animation has settled; `handleCloseDelete` ignores everything until then, so
 * tests wait for the marker before pressing Cancel.
 */
function deleteConfirmation(): HTMLElement {
  const heading = screen.getByRole('heading', { name: /^delete canvas$/i });
  const root = heading.closest('.t-modal');
  if (!(root instanceof HTMLElement)) throw new Error('delete confirmation not rendered');
  return root;
}

async function openDeleteConfirmation(user: UserEvent, name: string): Promise<HTMLElement> {
  await openRowMenu(user, name);
  await user.click(screen.getByRole('button', { name: /^delete$/i }));
  await waitFor(() => expect(deleteConfirmation()).toHaveClass('is-open'));
  return deleteConfirmation();
}

describe('FileBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('file list', () => {
    it('renders one link per file, pointing at the file route', () => {
      renderBrowser();

      expect(screen.getAllByRole('link')).toHaveLength(FILES.length);
      expect(rowLink('Alpha canvas')).toHaveAttribute('href', '/file/file-1');
      expect(rowLink('Beta canvas')).toHaveAttribute('href', '/file/file-2');
    });

    it('reports the number of files it was given', () => {
      renderBrowser();
      expect(screen.getByText(`(${FILES.length})`)).toBeInTheDocument();
    });

    it('shows the grid by default and switches to list on request', async () => {
      const user = userEvent.setup();
      renderBrowser();

      const gridToggle = screen.getByRole('button', { name: /grid view/i });
      const listToggle = screen.getByRole('button', { name: /list view/i });

      expect(gridToggle).toHaveAttribute('aria-pressed', 'true');
      expect(listToggle).toHaveAttribute('aria-pressed', 'false');

      await switchView(user, /list view/i);

      expect(listToggle).toHaveAttribute('aria-pressed', 'true');
      expect(gridToggle).toHaveAttribute('aria-pressed', 'false');
      expect(rowLink('Alpha canvas')).toBeInTheDocument();
    });
  });

  /**
   * The grid and list markup are two independent implementations of the same
   * row menu, so every gating and callback assertion runs against both.
   */
  describe.each([
    { name: 'grid', toggle: /grid view/i },
    { name: 'list', toggle: /list view/i },
  ])('$name view', ({ toggle }) => {
    it('renders no row menu at all when neither mutation handler is supplied', async () => {
      const user = userEvent.setup();
      renderBrowser();
      await switchView(user, toggle);

      for (const file of FILES) {
        expect(rowActionButtons(file.name)).toHaveLength(0);
      }
      expect(screen.queryByRole('button', { name: /^rename$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument();

      // Gating removes the controls, not the row: the file is still openable.
      expect(rowLink('Alpha canvas')).toHaveAttribute('href', '/file/file-1');
    });

    it('offers only Rename when only onRenameFile is supplied', async () => {
      const user = userEvent.setup();
      renderBrowser({ onRenameFile: vi.fn() });
      await switchView(user, toggle);
      await openRowMenu(user, 'Alpha canvas');

      expect(screen.getByRole('button', { name: /^rename$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument();

      // Sibling rows stay independently gated, not globally hidden.
      expect(rowActionButtons('Beta canvas')).toHaveLength(1);
    });

    it('offers only Delete when only onDeleteFile is supplied', async () => {
      const user = userEvent.setup();
      renderBrowser({ onDeleteFile: vi.fn() });
      await switchView(user, toggle);
      await openRowMenu(user, 'Alpha canvas');

      expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^rename$/i })).not.toBeInTheDocument();
    });

    it('offers both actions when both handlers are supplied', async () => {
      const user = userEvent.setup();
      renderBrowser({ onDeleteFile: vi.fn(), onRenameFile: vi.fn() });
      await switchView(user, toggle);
      await openRowMenu(user, 'Alpha canvas');

      expect(screen.getByRole('button', { name: /^rename$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
    });

    it('keeps one menu open at a time and toggles it closed on re-click', async () => {
      const user = userEvent.setup();
      renderBrowser({ onDeleteFile: vi.fn(), onRenameFile: vi.fn() });
      await switchView(user, toggle);

      await openRowMenu(user, 'Alpha canvas');
      expect(screen.getAllByRole('button', { name: /^rename$/i })).toHaveLength(1);

      await openRowMenu(user, 'Beta canvas');
      expect(screen.getAllByRole('button', { name: /^rename$/i })).toHaveLength(1);

      await openRowMenu(user, 'Beta canvas');
      expect(screen.queryByRole('button', { name: /^rename$/i })).not.toBeInTheDocument();
    });

    it('renames through onRenameFile with the row id and the committed name', async () => {
      const user = userEvent.setup();
      const onRenameFile = vi.fn();
      renderBrowser({ onRenameFile });
      await switchView(user, toggle);
      await openRowMenu(user, 'Alpha canvas');
      await user.click(screen.getByRole('button', { name: /^rename$/i }));

      const input = screen.getByDisplayValue('Alpha canvas');
      await user.clear(input);
      await user.type(input, 'Renamed canvas');
      await user.keyboard('{Enter}');

      expect(onRenameFile).toHaveBeenCalledTimes(1);
      expect(onRenameFile).toHaveBeenCalledWith('file-1', 'Renamed canvas');
      expect(screen.queryByDisplayValue('Renamed canvas')).not.toBeInTheDocument();
    });

    it('deletes through onDeleteFile only after the confirmation is accepted', async () => {
      const user = userEvent.setup();
      const onDeleteFile = vi.fn();
      renderBrowser({ onDeleteFile });
      await switchView(user, toggle);
      const confirmation = await openDeleteConfirmation(user, 'Beta canvas');

      expect(onDeleteFile).not.toHaveBeenCalled();
      expect(confirmation).toHaveTextContent(/are you sure you want to delete this canvas/i);

      await user.click(within(confirmation).getByRole('button', { name: /^delete$/i }));

      expect(onDeleteFile).toHaveBeenCalledTimes(1);
      expect(onDeleteFile).toHaveBeenCalledWith('file-2');
    });
  });

  describe('rename edge cases', () => {
    it('trims surrounding whitespace from the committed name', async () => {
      const user = userEvent.setup();
      const onRenameFile = vi.fn();
      renderBrowser({ onRenameFile });

      await openRowMenu(user, 'Alpha canvas');
      await user.click(screen.getByRole('button', { name: /^rename$/i }));
      await user.clear(screen.getByDisplayValue('Alpha canvas'));
      await user.type(screen.getByRole('textbox'), '  Padded canvas  ');
      await user.keyboard('{Enter}');

      expect(onRenameFile).toHaveBeenCalledWith('file-1', 'Padded canvas');
    });

    it('does not commit a whitespace-only name', async () => {
      const user = userEvent.setup();
      const onRenameFile = vi.fn();
      renderBrowser({ onRenameFile });

      await openRowMenu(user, 'Alpha canvas');
      await user.click(screen.getByRole('button', { name: /^rename$/i }));
      await user.clear(screen.getByDisplayValue('Alpha canvas'));
      await user.type(screen.getByRole('textbox'), '   ');
      await user.keyboard('{Enter}');

      expect(onRenameFile).not.toHaveBeenCalled();
      expect(screen.getByText('Alpha canvas')).toBeInTheDocument();
    });

    it('abandons the rename on Escape without calling the handler', async () => {
      const user = userEvent.setup();
      const onRenameFile = vi.fn();
      renderBrowser({ onRenameFile });

      await openRowMenu(user, 'Alpha canvas');
      await user.click(screen.getByRole('button', { name: /^rename$/i }));
      await user.clear(screen.getByDisplayValue('Alpha canvas'));
      await user.type(screen.getByRole('textbox'), 'Abandoned canvas');
      await user.keyboard('{Escape}');

      expect(onRenameFile).not.toHaveBeenCalled();
      expect(screen.getByText('Alpha canvas')).toBeInTheDocument();
    });

    it('only leaves one row editable at a time', async () => {
      const user = userEvent.setup();
      renderBrowser({ onRenameFile: vi.fn() });

      await openRowMenu(user, 'Alpha canvas');
      await user.click(screen.getByRole('button', { name: /^rename$/i }));
      await openRowMenu(user, 'Beta canvas');
      await user.click(screen.getByRole('button', { name: /^rename$/i }));

      expect(screen.getAllByRole('textbox')).toHaveLength(1);
      expect(screen.getByDisplayValue('Beta canvas')).toBeInTheDocument();
    });
  });

  describe('delete confirmation', () => {
    it('does not call onDeleteFile when the confirmation is cancelled', async () => {
      const user = userEvent.setup();
      const onDeleteFile = vi.fn();
      renderBrowser({ onDeleteFile });

      const confirmation = await openDeleteConfirmation(user, 'Alpha canvas');
      await user.click(within(confirmation).getByRole('button', { name: /^cancel$/i }));

      await waitFor(() =>
        expect(screen.queryByRole('heading', { name: /^delete canvas$/i })).not.toBeInTheDocument()
      );
      expect(onDeleteFile).not.toHaveBeenCalled();
      // Cancelling leaves the row menu reachable, i.e. the row is untouched.
      expect(rowActionButtons('Alpha canvas')).toHaveLength(1);
    });

    /**
     * Regression tests for a latch that was never released. `prevDeleteRef` was
     * cleared only by the `!deleteConfirmId` branch of the effect driving the
     * animation, but nothing ever set `deleteConfirmId` back to `null` —
     * `handleDelete` only ever assigns a file id. The first confirmation
     * therefore consumed the latch for the life of the mount, so every later
     * Delete click closed the row menu and showed nothing: a destructive
     * control that silently stopped working. The close timer now releases the
     * latch, and Delete must work repeatedly on both the cancel and the confirm
     * path.
     */
    it('opens the confirmation again for another file after one was cancelled', async () => {
      const user = userEvent.setup();
      const onDeleteFile = vi.fn();
      renderBrowser({ onDeleteFile });

      const first = await openDeleteConfirmation(user, 'Alpha canvas');
      await user.click(within(first).getByRole('button', { name: /^cancel$/i }));
      await waitFor(() =>
        expect(screen.queryByRole('heading', { name: /^delete canvas$/i })).not.toBeInTheDocument()
      );

      const second = await openDeleteConfirmation(user, 'Beta canvas');

      expect(within(second).getByRole('heading', { name: /^delete canvas$/i })).toBeInTheDocument();
      expect(onDeleteFile).not.toHaveBeenCalled();

      // Confirming must target the second file, proving the modal is bound to
      // the new request rather than replaying the cancelled one.
      await user.click(within(second).getByRole('button', { name: /^delete$/i }));
      await waitFor(() =>
        expect(screen.queryByRole('heading', { name: /^delete canvas$/i })).not.toBeInTheDocument()
      );
      expect(onDeleteFile).toHaveBeenCalledTimes(1);
      expect(onDeleteFile).toHaveBeenCalledWith('file-2');
    });

    it('opens the confirmation again for another file after one was accepted', async () => {
      const user = userEvent.setup();
      const onDeleteFile = vi.fn();
      renderBrowser({ onDeleteFile });

      const first = await openDeleteConfirmation(user, 'Alpha canvas');
      await user.click(within(first).getByRole('button', { name: /^delete$/i }));
      await waitFor(() =>
        expect(screen.queryByRole('heading', { name: /^delete canvas$/i })).not.toBeInTheDocument()
      );
      expect(onDeleteFile).toHaveBeenCalledTimes(1);
      expect(onDeleteFile).toHaveBeenCalledWith('file-1');

      const second = await openDeleteConfirmation(user, 'Beta canvas');

      expect(within(second).getByRole('heading', { name: /^delete canvas$/i })).toBeInTheDocument();
      expect(onDeleteFile).toHaveBeenCalledTimes(1);

      await user.click(within(second).getByRole('button', { name: /^delete$/i }));
      await waitFor(() =>
        expect(screen.queryByRole('heading', { name: /^delete canvas$/i })).not.toBeInTheDocument()
      );
      expect(onDeleteFile).toHaveBeenCalledTimes(2);
      expect(onDeleteFile).toHaveBeenLastCalledWith('file-2');
    });
  });

  describe('optional actions', () => {
    it('calls onStartNewCanvas and onOpenLocalCanvas when they are supplied', async () => {
      const user = userEvent.setup();
      const onStartNewCanvas = vi.fn();
      const onOpenLocalCanvas = vi.fn();
      renderBrowser({ onStartNewCanvas, onOpenLocalCanvas });

      await user.click(screen.getByRole('button', { name: /new canvas/i }));
      await user.click(screen.getByRole('button', { name: /open local canvas/i }));

      expect(onStartNewCanvas).toHaveBeenCalledTimes(1);
      expect(onOpenLocalCanvas).toHaveBeenCalledTimes(1);
    });

    /**
     * Characterisation, not endorsement: unlike the row menu, the header
     * actions are not gated on their handlers. A consumer that forgets
     * `onStartNewCanvas` still ships a fully styled, enabled, primary-coloured
     * button whose click is a guaranteed no-op.
     */
    it('still renders enabled header actions when their handlers are omitted', async () => {
      const user = userEvent.setup();
      renderBrowser();

      const newCanvas = screen.getByRole('button', { name: /new canvas/i });
      const localCanvas = screen.getByRole('button', { name: /open local canvas/i });

      expect(newCanvas).toBeEnabled();
      expect(localCanvas).toBeEnabled();

      await user.click(newCanvas);
      await user.click(localCanvas);

      expect(screen.getAllByRole('link')).toHaveLength(FILES.length);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(newCanvas).toBeEnabled();
    });

    it('reflects isCreatingCanvas on the header action', async () => {
      const user = userEvent.setup();
      const onStartNewCanvas = vi.fn();
      renderBrowser({ onStartNewCanvas, isCreatingCanvas: true });

      const busy = screen.getByRole('button', { name: /new canvas/i });
      expect(busy).toBeDisabled();
      expect(busy).toHaveTextContent(/creating/i);

      await user.click(busy);
      expect(onStartNewCanvas).not.toHaveBeenCalled();
    });
  });

  describe('empty state', () => {
    it('invokes the create callback from the empty state CTA', async () => {
      const user = userEvent.setup();
      const onStartNewCanvas = vi.fn();
      renderBrowser({ files: [], onStartNewCanvas });

      expect(screen.getByText(/no canvases yet/i)).toBeInTheDocument();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /create your first canvas/i }));

      expect(onStartNewCanvas).toHaveBeenCalledTimes(1);
    });

    /**
     * `files` arrives already filtered by the parent, so an empty search result
     * and an empty account are the same input to this component. It renders the
     * first-canvas empty state in both cases; there is no search-empty state to
     * select.
     */
    it('renders the first-canvas empty state, never a search-empty state', () => {
      renderBrowser({ files: [] });

      expect(screen.getByText(/no canvases yet/i)).toBeInTheDocument();
      expect(screen.queryByText(/no results found/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    });

    it('reflects isCreatingCanvas on the empty state CTA', async () => {
      const user = userEvent.setup();
      const onStartNewCanvas = vi.fn();
      renderBrowser({ files: [], onStartNewCanvas, isCreatingCanvas: true });

      const cta = screen.getByRole('button', { name: /creating/i });
      expect(cta).toBeDisabled();

      await user.click(cta);
      expect(onStartNewCanvas).not.toHaveBeenCalled();
    });

    it('renders an enabled no-op CTA when onStartNewCanvas is omitted', async () => {
      const user = userEvent.setup();
      renderBrowser({ files: [] });

      const cta = screen.getByRole('button', { name: /create your first canvas/i });
      expect(cta).toBeEnabled();

      await user.click(cta);
      expect(cta).toBeEnabled();
    });
  });

  describe('pagination', () => {
    it('hides the pager when everything fits on one page', () => {
      renderBrowser({ total: 2, page: 1, pageSize: 20 });
      expect(screen.queryByText(/page \d+ of \d+/i)).not.toBeInTheDocument();
    });

    it('paginates with onPageChange and clamps the ends', async () => {
      const user = userEvent.setup();
      const onPageChange = vi.fn();
      const { rerender } = renderBrowser({ total: 45, page: 1, pageSize: 20, onPageChange });

      expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
      expect(pagerButton(0)).toBeDisabled();
      expect(pagerButton(1)).toBeEnabled();

      await user.click(pagerButton(1));
      expect(onPageChange).toHaveBeenCalledWith(2);

      rerender(
        <FileBrowser files={FILES} total={45} page={3} pageSize={20} onPageChange={onPageChange} />
      );
      expect(pagerButton(1)).toBeDisabled();

      await user.click(pagerButton(0));
      expect(onPageChange).toHaveBeenLastCalledWith(2);
    });
  });
});
