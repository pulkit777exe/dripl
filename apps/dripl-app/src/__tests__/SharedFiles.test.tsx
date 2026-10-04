import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SharedFiles, type SharedFilesInitialData } from '@/components/dashboard/SharedFiles';
import type { apiClient, SharedFileSummary } from '@/lib/api';

/**
 * `SharedFiles` is the Collections list. It behaves like the dashboard list —
 * seeded page one, debounced search, absorbed mutation failures — with one
 * addition that is the whole reason it is a separate component: the API scopes
 * `PATCH`/`DELETE /files/:id` to the owner and answers 404 otherwise, so the
 * ownership gate (`ownedFileIds`) is the only thing standing between the row
 * menu and a menu item that silently does nothing.
 *
 * `FileBrowser` is real here too: "the row is still there" is only observable
 * in the rendered list.
 */

const router = vi.hoisted(() => ({ push: vi.fn() }));
const auth = vi.hoisted(() => ({
  user: { id: 'me', email: 'me@example.com', name: 'Me', image: null } as {
    id: string;
    email: string;
    name: string | null;
    image: string | null;
  } | null,
}));
const api = vi.hoisted(() => ({
  listSharedFiles: vi.fn<typeof apiClient.listSharedFiles>(),
  createFile: vi.fn<typeof apiClient.createFile>(),
  updateFile: vi.fn<typeof apiClient.updateFile>(),
  deleteFile: vi.fn<typeof apiClient.deleteFile>(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/app/context/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock('@/lib/api', () => ({ apiClient: api }));

/** A canvas owned by somebody else — the normal case on this page. */
const THEIRS = 'file-theirs';
/** The degenerate case the ownership gate has to let through: shared back to me. */
const MINE = 'file-mine';

function sharedFile(id: string, name: string, userId: string | null): SharedFileSummary {
  return {
    id,
    name,
    preview: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    userId,
    sharedAt: '2026-01-03T00:00:00.000Z',
    sharedBy: { id: 'someone', name: 'Someone', email: 's@example.com', image: null },
  };
}

function pageOf(files: SharedFileSummary[], total: number, pageNumber = 1) {
  return { files, total, page: pageNumber, limit: 20 };
}

function renderShared(initial: Partial<SharedFilesInitialData> = {}) {
  const data: SharedFilesInitialData = {
    files: [sharedFile(THEIRS, 'Their canvas', 'someone'), sharedFile(MINE, 'My canvas', 'me')],
    total: 2,
    page: 1,
    limit: 20,
    ...initial,
  };
  return render(<SharedFiles initial={data} />);
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

async function settle(): Promise<void> {
  await act(async () => {});
}

const searchBox = () => screen.getByPlaceholderText('Search shared files...');

const newCanvasButton = () => screen.getByRole('button', { name: /new canvas/i });

const row = (name: string) => screen.getByRole('link', { name: new RegExp(name, 'i') });

function rowMenuButton(name: string): HTMLElement {
  const [button] = within(row(name)).queryAllByRole('button');
  if (!button) throw new Error(`row "${name}" rendered no action button`);
  return button;
}

function pagerButton(index: 0 | 1): HTMLElement {
  const [indicator] = screen.queryAllByText(/page \d+ of \d+/i);
  const pager = indicator?.parentElement;
  if (!pager) throw new Error('pager not rendered');
  const [button] = within(pager).queryAllByRole('button').slice(index);
  if (!button) throw new Error(`pager button ${index} not found`);
  return button;
}

async function openDeleteConfirmation(name: string): Promise<HTMLElement> {
  fireEvent.click(rowMenuButton(name));
  fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
  await act(async () => {
    vi.advanceTimersToNextFrame();
  });
  const heading = screen.getByRole('heading', { name: /^delete canvas$/i });
  const modal = heading.closest('.t-modal');
  if (!(modal instanceof HTMLElement)) throw new Error('confirmation not rendered');
  return modal;
}

async function deleteRow(name: string): Promise<void> {
  const modal = await openDeleteConfirmation(name);
  fireEvent.click(within(modal).getByRole('button', { name: /^delete$/i }));
  await settle();
  await advance(200);
}

function renameRow(name: string, nextName: string): void {
  fireEvent.click(rowMenuButton(name));
  fireEvent.click(screen.getByRole('button', { name: /^rename$/i }));
  fireEvent.change(screen.getByDisplayValue(name), { target: { value: nextName } });
  fireEvent.keyDown(screen.getByDisplayValue(nextName), { key: 'Enter' });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  auth.user = { id: 'me', email: 'me@example.com', name: 'Me', image: null };
  api.listSharedFiles.mockResolvedValue(pageOf([], 0));
});

describe('SharedFiles — seeding', () => {
  /**
   * Regression: the search effect used to depend on `user`, so it fired once for
   * "the user arrived" and again for "the user typed" — two identical
   * `/files/shared` calls per visit. `seededRef` is the deleted first one.
   */
  it('never re-requests the page the server already rendered', async () => {
    renderShared();

    await advance(1_000);

    expect(api.listSharedFiles).not.toHaveBeenCalled();
  });

  it('renders the seeded rows straight away', () => {
    renderShared();

    expect(row('Their canvas')).toHaveAttribute('href', `/file/${THEIRS}`);
    expect(row('My canvas')).toHaveAttribute('href', `/file/${MINE}`);
    expect(screen.getByText('(2)')).toBeInTheDocument();
  });
});

describe('SharedFiles — ownership gate', () => {
  /**
   * Regression: this is the gate the whole page exists to apply. The API scopes
   * `DELETE /files/:id` to the owner, so without `ownedFileIds.has(id)` the row
   * menu deletes the row locally, the request 404s, and the user is told the
   * canvas is gone while it is still on the server and still on screen for
   * everyone else.
   */
  it('refuses to delete somebody else’s canvas and keeps the row', async () => {
    api.deleteFile.mockResolvedValue(undefined);
    renderShared();

    await deleteRow('Their canvas');

    expect(api.deleteFile).not.toHaveBeenCalled();
    expect(screen.getByText('Only the owner can delete a shared canvas.')).toBeInTheDocument();
    expect(row('Their canvas')).toBeInTheDocument();
    expect(screen.getByText('(2)')).toBeInTheDocument();
  });

  /**
   * Regression: the same gate guards rename. Unguarded, a rename on someone
   * else's row 404s, and without the local-write-after-await ordering the tile
   * would keep a name the server never accepted.
   */
  it('refuses to rename somebody else’s canvas', async () => {
    api.updateFile.mockResolvedValue({ file: fileOf(THEIRS) });
    renderShared();

    renameRow('Their canvas', 'Hijacked');
    await settle();

    expect(api.updateFile).not.toHaveBeenCalled();
    expect(screen.getByText('Only the owner can rename a shared canvas.')).toBeInTheDocument();
    expect(row('Their canvas')).toBeInTheDocument();
  });

  /**
   * Regression: the degenerate case the gate exists to preserve — a canvas
   * shared back to its owner. An ownership check written as "not mine" or keyed
   * on `sharedBy.id` instead of `userId` locks the owner out of their own file.
   */
  it('allows a canvas shared back to its owner to be deleted', async () => {
    api.deleteFile.mockResolvedValue(undefined);
    renderShared();

    await deleteRow('My canvas');

    expect(api.deleteFile).toHaveBeenCalledWith(MINE);
    expect(screen.queryByRole('link', { name: /my canvas/i })).not.toBeInTheDocument();
    expect(screen.getByText('(1)')).toBeInTheDocument();
  });

  /**
   * Regression: a row whose `userId` is `null` (a legacy/deleted owner) is not
   * owned by anybody, so it must not be deletable. `file.userId &&` is what
   * keeps a null id out of the owned set — `null === user.id` cannot happen, but
   * a falsy-check-free `===` on a null id is one refactor away from trouble.
   */
  it('treats a canvas with no owner as unowned', async () => {
    api.deleteFile.mockResolvedValue(undefined);
    renderShared({ files: [sharedFile('orphan', 'Orphan canvas', null)], total: 1 });

    await deleteRow('Orphan canvas');

    expect(api.deleteFile).not.toHaveBeenCalled();
    expect(row('Orphan canvas')).toBeInTheDocument();
  });

  /**
   * Regression: with no signed-in user there is nothing to own, so every row is
   * read-only and the page degrades to a browsable list instead of offering
   * destructive actions that all 404.
   */
  it('offers no mutations at all while signed out', async () => {
    auth.user = null;
    api.deleteFile.mockResolvedValue(undefined);
    renderShared();

    await deleteRow('My canvas');

    expect(api.deleteFile).not.toHaveBeenCalled();
    expect(screen.getByText('Only the owner can delete a shared canvas.')).toBeInTheDocument();
  });
});

function fileOf(id: string) {
  return {
    id,
    name: 'unused',
    preview: null,
    folderId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };
}

describe('SharedFiles — search', () => {
  /** Regression: the query is debounced, trimmed, and scoped to page one. */
  it('sends the trimmed term against page one once the debounce elapses', async () => {
    renderShared();

    fireEvent.change(searchBox(), { target: { value: '  Their  ' } });
    await advance(249);
    expect(api.listSharedFiles).not.toHaveBeenCalled();

    await advance(1);
    expect(api.listSharedFiles).toHaveBeenCalledTimes(1);
    expect(api.listSharedFiles).toHaveBeenCalledWith({
      search: 'Their',
      page: 1,
      limit: 20,
    });
  });

  /**
   * Regression: a whitespace-only query means "no filter", not a literal
   * whitespace filter that matches nothing.
   */
  it('treats a whitespace-only query as no filter', async () => {
    renderShared();

    fireEvent.change(searchBox(), { target: { value: '   ' } });
    await advance(250);

    expect(api.listSharedFiles).toHaveBeenCalledWith({
      search: undefined,
      page: 1,
      limit: 20,
    });
  });

  /**
   * Regression: `setActionError(null)` at the top of the search effect. Without
   * it, a banner left over from a refused delete or rename survives every
   * subsequent search and keeps claiming a failure the user has moved on from.
   * This is the one behaviour where `SharedFiles` and `DashboardFiles`
   * deliberately differ.
   */
  it('clears a stale failure banner as soon as a search is typed', async () => {
    api.deleteFile.mockRejectedValue(new Error('Forbidden'));
    renderShared();

    await deleteRow('Their canvas');
    expect(screen.getByText('Only the owner can delete a shared canvas.')).toBeInTheDocument();

    fireEvent.change(searchBox(), { target: { value: 'their' } });

    expect(
      screen.queryByText('Only the owner can delete a shared canvas.')
    ).not.toBeInTheDocument();
  });

  /**
   * Regression: `handlePageChange` forwards the live query. Forwarding `''`
   * instead drops the user's search the moment they page.
   */
  it('carries the active query into the next page request', async () => {
    api.listSharedFiles.mockResolvedValue(
      pageOf([sharedFile(THEIRS, 'Their canvas', 'someone')], 45, 1)
    );
    renderShared({ total: 45 });

    fireEvent.change(searchBox(), { target: { value: 'their' } });
    await advance(250);
    await settle();

    fireEvent.click(pagerButton(1));
    await settle();

    expect(api.listSharedFiles).toHaveBeenLastCalledWith({
      search: 'their',
      page: 2,
      limit: 20,
    });
  });

  /**
   * Regression: a search is scoped to page one. Requesting the page the user is
   * currently on lands them on an out-of-range page of the filtered set, which
   * reads as an empty Collections page.
   */
  it('returns to page one when a search runs from a later page', async () => {
    api.listSharedFiles.mockImplementation(params =>
      Promise.resolve(
        pageOf([sharedFile(THEIRS, 'Their canvas', 'someone')], 45, params?.page ?? 1)
      )
    );
    renderShared({ total: 45 });

    fireEvent.click(pagerButton(1));
    await settle();
    expect(screen.getByText(/page 2 of 3/i)).toBeInTheDocument();

    fireEvent.change(searchBox(), { target: { value: 'their' } });
    await advance(250);

    expect(api.listSharedFiles).toHaveBeenLastCalledWith({
      search: 'their',
      page: 1,
      limit: 20,
    });
  });

  /**
   * Regression: ownership is derived from the *fetched* rows, so it has to be
   * recomputed when a page change replaces them — the `useMemo` dependency on
   * `files` is the whole mechanism. Captured once from the seeded props, a page
   * two of canvases that happen to be shared back to me becomes undeletable and
   * un-renameable, while its rows are still offered the menu items.
   */
  it('re-gates ownership against the rows a page change brings in', async () => {
    api.listSharedFiles.mockResolvedValue(
      pageOf(
        [
          sharedFile('mine-2', 'Mine on page two', 'me'),
          sharedFile('theirs-2', 'Theirs on page two', 'someone'),
        ],
        45,
        2
      )
    );
    api.deleteFile.mockResolvedValue(undefined);
    renderShared({ total: 45 });

    fireEvent.click(pagerButton(1));
    await settle();

    await deleteRow('Mine on page two');
    expect(api.deleteFile).toHaveBeenCalledWith('mine-2');

    await deleteRow('Theirs on page two');
    expect(api.deleteFile).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Only the owner can delete a shared canvas.')).toBeInTheDocument();
    expect(row('Theirs on page two')).toBeInTheDocument();
  });
});

describe('SharedFiles — create', () => {
  /**
   * Regression: creating a canvas on the Collections page announces it, which is
   * what the dashboard sidebar's plan meter listens for. Dropping the dispatch
   * leaves the meter reporting the pre-create count.
   */
  it('announces the new file and opens it', async () => {
    api.createFile.mockResolvedValue({ id: 'fresh', name: 'Untitled canvas' });
    const onFilesChanged = vi.fn();
    window.addEventListener('dripl:files-changed', onFilesChanged);
    renderShared();

    fireEvent.click(newCanvasButton());
    await settle();

    expect(api.createFile).toHaveBeenCalledWith({ name: 'Untitled canvas', content: [] });
    expect(onFilesChanged).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/file/fresh');
    window.removeEventListener('dripl:files-changed', onFilesChanged);
  });

  /** Regression: the same-tick latch, i.e. two clicks inside one React batch. */
  it('creates only one file for two same-tick clicks', async () => {
    api.createFile.mockResolvedValue({ id: 'fresh', name: 'Untitled canvas' });
    renderShared();

    act(() => {
      newCanvasButton().click();
      newCanvasButton().click();
    });
    await settle();

    expect(api.createFile).toHaveBeenCalledTimes(1);
  });

  /** Regression: the latch is released in `finally`, so a failure is retryable. */
  it('allows a retry after a failed create', async () => {
    api.createFile.mockRejectedValueOnce(new Error('quota exceeded'));
    api.createFile.mockResolvedValueOnce({ id: 'second', name: 'Untitled canvas' });
    renderShared();

    fireEvent.click(newCanvasButton());
    await settle();
    expect(screen.getByText('quota exceeded')).toBeInTheDocument();

    fireEvent.click(newCanvasButton());
    await settle();

    expect(api.createFile).toHaveBeenCalledTimes(2);
    expect(router.push).toHaveBeenCalledWith('/file/second');
  });

  /** Regression: the non-`Error` fallback keeps the banner readable. */
  it('falls back to a readable message for a non-Error create rejection', async () => {
    api.createFile.mockRejectedValue(undefined);
    renderShared();

    fireEvent.click(newCanvasButton());
    await settle();

    expect(screen.getByText('Failed to create canvas')).toBeInTheDocument();
  });

  /** Regression: the local-canvas action must not create a server-side file. */
  it('routes the local-canvas action to the local editor', () => {
    renderShared();

    fireEvent.click(screen.getByRole('button', { name: /open local canvas/i }));

    expect(router.push).toHaveBeenCalledWith('/canvas');
    expect(api.createFile).not.toHaveBeenCalled();
  });
});

describe('SharedFiles — delete', () => {
  /** Regression: a successful delete drops exactly one row and bumps the event. */
  it('removes the deleted row, decrements the count and announces the change', async () => {
    api.deleteFile.mockResolvedValue(undefined);
    const onFilesChanged = vi.fn();
    window.addEventListener('dripl:files-changed', onFilesChanged);
    renderShared();

    await deleteRow('My canvas');

    expect(screen.queryByRole('link', { name: /my canvas/i })).not.toBeInTheDocument();
    expect(row('Their canvas')).toBeInTheDocument();
    expect(screen.getByText('(1)')).toBeInTheDocument();
    expect(onFilesChanged).toHaveBeenCalledTimes(1);
    window.removeEventListener('dripl:files-changed', onFilesChanged);
  });

  /**
   * Regression: the row is filtered out only after the server agrees. Optimistic
   * removal on a 404 from a stale ownership check destroys the user's copy of
   * the list without touching the server.
   */
  it('keeps the row when the server refuses the delete', async () => {
    api.deleteFile.mockRejectedValue(new Error('Forbidden'));
    const onFilesChanged = vi.fn();
    window.addEventListener('dripl:files-changed', onFilesChanged);
    renderShared();

    await deleteRow('My canvas');

    expect(api.deleteFile).toHaveBeenCalledWith(MINE);
    expect(row('My canvas')).toBeInTheDocument();
    expect(screen.getByText('(2)')).toBeInTheDocument();
    expect(screen.getByText('Forbidden')).toBeInTheDocument();
    expect(onFilesChanged).not.toHaveBeenCalled();
    window.removeEventListener('dripl:files-changed', onFilesChanged);
  });

  /**
   * Regression: deleting the last shared canvas falls through to the empty
   * state rather than leaving a blank panel where the list was.
   */
  it('falls through to the empty state once the last row is gone', async () => {
    api.deleteFile.mockResolvedValue(undefined);
    renderShared({ files: [sharedFile(MINE, 'My canvas', 'me')], total: 1 });

    await deleteRow('My canvas');

    expect(screen.getByText(/no canvases yet/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  /** Regression: the non-`Error` fallback for a rejected delete. */
  it('falls back to a readable message for a non-Error delete rejection', async () => {
    api.deleteFile.mockRejectedValue({ status: 500 });
    renderShared();

    await deleteRow('My canvas');

    expect(screen.getByText('Failed to delete canvas')).toBeInTheDocument();
    expect(row('My canvas')).toBeInTheDocument();
  });
});

describe('SharedFiles — rename', () => {
  /** Regression: the rename is matched by id, so only that row changes. */
  it('renames only the targeted row', async () => {
    api.updateFile.mockResolvedValue({ file: fileOf(MINE) });
    renderShared();

    renameRow('My canvas', 'My renamed canvas');
    await settle();

    expect(api.updateFile).toHaveBeenCalledWith(MINE, { name: 'My renamed canvas' });
    expect(row('My renamed canvas')).toBeInTheDocument();
    expect(row('Their canvas')).toBeInTheDocument();
  });

  /**
   * Regression: the new name is written only after the server accepts it. Written
   * first, a rejected rename shows a name that the next refetch silently undoes.
   */
  it('leaves the old name in place when the rename is refused', async () => {
    api.updateFile.mockRejectedValue(new Error('Name taken'));
    renderShared();

    renameRow('My canvas', 'My renamed canvas');
    await settle();

    expect(screen.getByText('Name taken')).toBeInTheDocument();
    expect(screen.getByText('My canvas')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('My renamed canvas')).not.toBeInTheDocument();
  });

  /** Regression: the non-`Error` fallback for a rejected rename. */
  it('falls back to a readable message for a non-Error rename rejection', async () => {
    api.updateFile.mockRejectedValue(false);
    renderShared();

    renameRow('My canvas', 'My renamed canvas');
    await settle();

    expect(screen.getByText('Failed to rename canvas')).toBeInTheDocument();
  });
});

describe('SharedFiles — empty state', () => {
  /**
   * Regression: an empty Collections page still has to be actionable — the
   * create CTA reaches `createFile`, i.e. `onStartNewCanvas` must survive the
   * handoff to `FileBrowser`.
   */
  it('offers a working create action when nothing is shared', async () => {
    api.createFile.mockResolvedValue({ id: 'first', name: 'Untitled canvas' });
    renderShared({ files: [], total: 0 });

    expect(screen.getByText(/no canvases yet/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /create your first canvas/i }));
    await settle();

    expect(api.createFile).toHaveBeenCalledTimes(1);
  });

  /**
   * Regression: a search that matches nothing writes the empty response back, so
   * the page shows the empty state rather than the previous page's rows under a
   * query that matches none of them.
   */
  it('shows the empty state when a search matches nothing', async () => {
    api.listSharedFiles.mockResolvedValue(pageOf([], 0));
    renderShared();

    fireEvent.change(searchBox(), { target: { value: 'nothing' } });
    await advance(250);
    await settle();

    expect(screen.getByText(/no canvases yet/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
