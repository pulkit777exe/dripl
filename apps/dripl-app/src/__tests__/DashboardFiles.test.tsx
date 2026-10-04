import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardFiles, type DashboardInitialFiles } from '@/components/dashboard/DashboardFiles';
import type { apiClient, FileSummary } from '@/lib/api';

/**
 * `DashboardFiles` is the island that owns the dashboard list now that
 * `app/dashboard/page.tsx` seeds it. Everything worth pinning here is
 * something that component does *around* the data: when it decides to refetch,
 * when it decides not to, and what it does to the rows when a mutation is
 * refused.
 *
 * `FileBrowser` is deliberately **not** mocked — the interesting assertions
 * ("the row is still there", "the count went down") are only visible in the
 * rendered list, and the row menu / rename / delete-confirmation plumbing is
 * what a user actually drives.
 */

const router = vi.hoisted(() => ({ push: vi.fn() }));
const api = vi.hoisted(() => ({
  listFiles: vi.fn<typeof apiClient.listFiles>(),
  createFile: vi.fn<typeof apiClient.createFile>(),
  updateFile: vi.fn<typeof apiClient.updateFile>(),
  deleteFile: vi.fn<typeof apiClient.deleteFile>(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/api', () => ({ apiClient: api }));

const ALPHA = 'file-a';
const BETA = 'file-b';

function file(id: string, name: string): FileSummary {
  return {
    id,
    name,
    preview: null,
    folderId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };
}

function pageOf(files: FileSummary[], total: number, pageNumber = 1) {
  return { files, total, page: pageNumber, limit: 20 };
}

function renderDashboard(initial: Partial<DashboardInitialFiles> = {}) {
  const data: DashboardInitialFiles = {
    files: [file(ALPHA, 'Alpha canvas'), file(BETA, 'Beta canvas')],
    total: 2,
    page: 1,
    limit: 20,
    ...initial,
  };
  return render(<DashboardFiles initial={data} />);
}

/** Fires the debounce (and any timer the component queued) and drains microtasks. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

/** Lets already-settled API promises land without moving any clock. */
async function settle(): Promise<void> {
  await act(async () => {});
}

const searchBox = () => screen.getByPlaceholderText('Search files...');

const newCanvasButton = () => screen.getByRole('button', { name: /new canvas/i });

const row = (name: string) => screen.getByRole('link', { name: new RegExp(name, 'i') });

/**
 * The row's action trigger is an icon-only button with no accessible name, so
 * it is addressed by its position inside the row, like the FileBrowser suite
 * does.
 */
function rowMenuButton(name: string): HTMLElement {
  const [button] = within(row(name)).queryAllByRole('button');
  if (!button) throw new Error(`row "${name}" rendered no action button`);
  return button;
}

/** The pager's chevrons are icon-only: 0 is previous, 1 is next. */
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
  // Let the close animation finish so the portal stops shadowing row controls.
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
  api.listFiles.mockResolvedValue(pageOf([], 0));
});

describe('DashboardFiles — seeding', () => {
  /**
   * Regression: the search effect used to run once for "the user arrived" and
   * again for "the user typed", so every dashboard visit paid two identical
   * `/files` requests before the user touched anything. `seededRef` is the
   * deleted first one; removing its guard brings the duplicate straight back.
   */
  it('never re-requests the page the server already rendered', async () => {
    renderDashboard();

    await advance(1_000);

    expect(api.listFiles).not.toHaveBeenCalled();
  });

  /**
   * Regression: the seeded page has to reach the screen, not just the state —
   * a `FileBrowser` that received `files={[]}` (or no files prop at all) would
   * show the first-canvas empty state on a populated account.
   */
  it('renders the seeded rows straight away', () => {
    renderDashboard();

    expect(row('Alpha canvas')).toHaveAttribute('href', `/file/${ALPHA}`);
    expect(row('Beta canvas')).toHaveAttribute('href', `/file/${BETA}`);
    expect(screen.getByText('(2)')).toBeInTheDocument();
  });
});

describe('DashboardFiles — search', () => {
  /**
   * Regression: the effect debounces by 250ms. Firing the request immediately
   * (or on every keystroke) sends one `/files` per character typed.
   */
  it('waits out the debounce before querying', async () => {
    renderDashboard();

    fireEvent.change(searchBox(), { target: { value: 'alpha' } });
    await advance(249);
    expect(api.listFiles).not.toHaveBeenCalled();

    await advance(1);
    expect(api.listFiles).toHaveBeenCalledTimes(1);
  });

  /**
   * Regression: the query is trimmed before it is sent. Untrimmed, the server
   * matches nothing and the list empties for a query the user can see is
   * non-blank.
   */
  it('sends the trimmed term against page one', async () => {
    renderDashboard();

    fireEvent.change(searchBox(), { target: { value: '  Alpha  ' } });
    await advance(250);

    expect(api.listFiles).toHaveBeenCalledWith({ search: 'Alpha', page: 1, limit: 20 });
  });

  /**
   * Regression: the debounce is restarted on every keystroke, so a burst
   * collapses to one request. A missing cleanup (`clearTimeout`) turns five
   * characters into five requests.
   */
  it('collapses a burst of keystrokes into a single request', async () => {
    renderDashboard();

    for (const term of ['a', 'al', 'alp', 'alph', 'alpha']) {
      fireEvent.change(searchBox(), { target: { value: term } });
      await advance(100);
    }
    await advance(250);

    expect(api.listFiles).toHaveBeenCalledTimes(1);
    expect(api.listFiles).toHaveBeenLastCalledWith({ search: 'alpha', page: 1, limit: 20 });
  });

  /**
   * Regression: an all-whitespace query is "no filter", not a literal
   * whitespace filter. `search: ''` reaches the client as a real query value and
   * a `<input>` cleared by the browser sends `''`, so the `|| undefined` is what
   * keeps the cleared box from searching for blanks.
   */
  it('treats a whitespace-only query as no filter', async () => {
    renderDashboard();

    fireEvent.change(searchBox(), { target: { value: '   ' } });
    await advance(250);

    expect(api.listFiles).toHaveBeenCalledWith({ search: undefined, page: 1, limit: 20 });
  });

  /**
   * Regression: a search that matches nothing must *clear* the rows. If the
   * empty response is not written back, the previous page's canvases stay on
   * screen under a query that matches none of them.
   */
  it('shows the empty state when the query matches nothing', async () => {
    api.listFiles.mockResolvedValue(pageOf([], 0));
    renderDashboard();

    fireEvent.change(searchBox(), { target: { value: 'nothing matches' } });
    await advance(250);
    await settle();

    expect(screen.getByText(/no canvases yet/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  /**
   * Regression: a search is scoped to page one. Requesting the page the user
   * happens to be on lands them on an out-of-range page of the filtered set,
   * which reads as an empty dashboard.
   */
  it('returns to page one when a search runs from a later page', async () => {
    // Echo the requested page, so the pager really is on page 2 when the search
    // is typed. A mock that always answers `page: 1` would hide that.
    api.listFiles.mockImplementation(params =>
      Promise.resolve(pageOf([file(ALPHA, 'Alpha canvas')], 45, params?.page ?? 1))
    );
    renderDashboard({ total: 45 });

    fireEvent.click(pagerButton(1));
    await settle();
    expect(screen.getByText(/page 2 of 3/i)).toBeInTheDocument();

    fireEvent.change(searchBox(), { target: { value: 'alpha' } });
    await advance(250);

    expect(api.listFiles).toHaveBeenLastCalledWith({ search: 'alpha', page: 1, limit: 20 });
  });

  /**
   * Regression: the optimistic `setPage(newPage)` in `handlePageChange` must be
   * overwritten by the page the *server* answered with. Trusting the request
   * makes the pager advertise a page that does not exist — reachable whenever
   * the set shrinks under the user (files deleted from another tab) between the
   * render and the click.
   */
  it('adopts the page the server answered with, not the one requested', async () => {
    api.listFiles.mockResolvedValue(pageOf([file(ALPHA, 'Alpha canvas')], 45, 1));
    renderDashboard({ total: 45 });
    expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument();

    fireEvent.click(pagerButton(1));
    await settle();

    expect(api.listFiles).toHaveBeenLastCalledWith({ search: undefined, page: 2, limit: 20 });
    // The server clamped page 2 down to page 1; the pager must follow it.
    expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument();
    expect(pagerButton(0)).toBeDisabled();
  });
});

describe('DashboardFiles — pagination', () => {
  /**
   * Regression: `handlePageChange` closes over the live `search` value and
   * forwards it. Forwarding `''` instead silently drops the user's query the
   * moment they page, and the list repopulates with unrelated canvases.
   */
  it('carries the active query into the next page request', async () => {
    api.listFiles.mockResolvedValue(pageOf([file(ALPHA, 'Alpha canvas')], 45, 1));
    renderDashboard({ total: 45 });

    fireEvent.change(searchBox(), { target: { value: 'alpha' } });
    await advance(250);
    await settle();

    fireEvent.click(pagerButton(1));
    await settle();

    expect(api.listFiles).toHaveBeenLastCalledWith({ search: 'alpha', page: 2, limit: 20 });
  });

  /** Regression: the pager's page and the fetched page cannot drift apart. */
  it('advances the indicator and the rows together', async () => {
    api.listFiles.mockResolvedValue(pageOf([file(BETA, 'Beta canvas')], 45, 2));
    renderDashboard({ total: 45 });

    fireEvent.click(pagerButton(1));
    await settle();

    expect(screen.getByText(/page 2 of 3/i)).toBeInTheDocument();
    expect(row('Beta canvas')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /alpha canvas/i })).not.toBeInTheDocument();
  });
});

describe('DashboardFiles — create', () => {
  /**
   * Regression: `dripl:files-changed` is the only signal the sidebar's plan
   * meter listens for. Drop the dispatch and the meter keeps reporting the count
   * from before the canvas existed, so the user is told they are out of quota on
   * an empty account.
   */
  it('announces the new file to the rest of the app', async () => {
    api.createFile.mockResolvedValue({ id: 'new-file', name: 'Untitled canvas' });
    const onFilesChanged = vi.fn();
    window.addEventListener('dripl:files-changed', onFilesChanged);
    renderDashboard();

    fireEvent.click(newCanvasButton());
    await settle();

    expect(api.createFile).toHaveBeenCalledWith({ name: 'Untitled canvas', content: [] });
    expect(onFilesChanged).toHaveBeenCalledTimes(1);
    window.removeEventListener('dripl:files-changed', onFilesChanged);
  });

  /**
   * Regression: the secondary "Local Canvas" action navigates to `/canvas`
   * rather than creating anything. Collapsing it onto the create path would
   * create a server-side canvas the user never asked for on the way to the
   * local editor.
   */
  it('routes the local-canvas action to the local editor', () => {
    renderDashboard();

    fireEvent.click(screen.getByRole('button', { name: /open local canvas/i }));

    expect(router.push).toHaveBeenCalledWith('/canvas');
    expect(api.createFile).not.toHaveBeenCalled();
  });

  /** Regression: a created canvas must be opened, not merely announced. */
  it('navigates to the canvas it created', async () => {
    api.createFile.mockResolvedValue({ id: 'new-file', name: 'Untitled canvas' });
    renderDashboard();

    fireEvent.click(newCanvasButton());
    await settle();

    expect(router.push).toHaveBeenCalledWith('/file/new-file');
  });

  /**
   * Regression: `createInFlightRef` latches the create so a same-tick second
   * click cannot create an orphan. Both clicks land inside one `act`, i.e.
   * before React can disable the button, which is exactly the window the latch
   * exists for. Without it two files are created and only the first is opened.
   */
  it('creates only one file for two same-tick clicks', async () => {
    api.createFile.mockResolvedValue({ id: 'new-file', name: 'Untitled canvas' });
    renderDashboard();

    act(() => {
      newCanvasButton().click();
      newCanvasButton().click();
    });
    await settle();

    expect(api.createFile).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  /**
   * Regression: the latch is released in `finally`. If it leaked, the first
   * failed create would disable the button's behaviour for the rest of the
   * page's life and the user could never make another canvas.
   */
  it('allows a retry after a failed create', async () => {
    api.createFile.mockRejectedValueOnce(new Error('quota exceeded'));
    api.createFile.mockResolvedValueOnce({ id: 'second', name: 'Untitled canvas' });
    renderDashboard();

    fireEvent.click(newCanvasButton());
    await settle();
    expect(screen.getByText('quota exceeded')).toBeInTheDocument();

    fireEvent.click(newCanvasButton());
    await settle();

    expect(api.createFile).toHaveBeenCalledTimes(2);
    expect(router.push).toHaveBeenCalledWith('/file/second');
  });

  /**
   * Regression: a rejected create must not navigate and must not touch the
   * list, and must say why. Swallowing the error leaves an enabled button that
   * silently does nothing, which is indistinguishable from a broken product.
   */
  it('surfaces a rejected create and leaves the list untouched', async () => {
    api.createFile.mockRejectedValue(new Error('quota exceeded'));
    renderDashboard();

    fireEvent.click(newCanvasButton());
    await settle();

    expect(screen.getByText('quota exceeded')).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
    expect(row('Alpha canvas')).toBeInTheDocument();
    expect(row('Beta canvas')).toBeInTheDocument();
  });

  /**
   * Regression: the banner text comes from `error instanceof Error ?
   * error.message : 'Failed to create canvas'`. A bare rejection value (a
   * thrown string, or a `fetch` that rejected with something exotic) has no
   * `.message`, so without the guard the banner renders an empty red box.
   */
  it('falls back to a readable message for a non-Error rejection', async () => {
    api.createFile.mockRejectedValue('kaboom');
    renderDashboard();

    fireEvent.click(newCanvasButton());
    await settle();

    expect(screen.getByText('Failed to create canvas')).toBeInTheDocument();
  });

  /**
   * Regression: `isCreatingCanvas` gates the button's disabled state. If it were
   * never set, the button stays clickable through a request already in flight —
   * the state that the same-tick latch exists to cover.
   */
  it('disables the create button while the request is in flight', async () => {
    let settleCreate: (value: { id: string; name: string }) => void = () => {};
    api.createFile.mockReturnValue(
      new Promise<{ id: string; name: string }>(resolve => {
        settleCreate = resolve;
      })
    );
    renderDashboard();

    fireEvent.click(newCanvasButton());
    await settle();
    expect(newCanvasButton()).toBeDisabled();
    expect(newCanvasButton()).toHaveTextContent(/creating/i);

    settleCreate({ id: 'new-file', name: 'Untitled canvas' });
    await settle();
    expect(newCanvasButton()).toBeEnabled();
  });
});

describe('DashboardFiles — delete', () => {
  /**
   * Regression: only the deleted row is dropped and the header count follows.
   * A no-op `setFiles(prev => prev)` leaves a canvas the user believes they
   * deleted on screen, one click from a second delete.
   */
  it('removes the deleted row and decrements the count', async () => {
    api.deleteFile.mockResolvedValue(undefined);
    const onFilesChanged = vi.fn();
    window.addEventListener('dripl:files-changed', onFilesChanged);
    renderDashboard();

    await deleteRow('Alpha canvas');

    expect(api.deleteFile).toHaveBeenCalledWith(ALPHA);
    expect(screen.queryByRole('link', { name: /alpha canvas/i })).not.toBeInTheDocument();
    expect(row('Beta canvas')).toBeInTheDocument();
    expect(screen.getByText('(1)')).toBeInTheDocument();
    expect(onFilesChanged).toHaveBeenCalledTimes(1);
    window.removeEventListener('dripl:files-changed', onFilesChanged);
  });

  /**
   * Regression: the row is filtered out *after* the server agrees. Optimistic
   * removal (or removing in the `catch`) makes a refused delete look like it
   * worked — the row vanishes and the canvas is still on the server.
   */
  it('keeps the row when the server refuses the delete', async () => {
    api.deleteFile.mockRejectedValue(new Error('Forbidden'));
    const onFilesChanged = vi.fn();
    window.addEventListener('dripl:files-changed', onFilesChanged);
    renderDashboard();

    await deleteRow('Alpha canvas');

    expect(row('Alpha canvas')).toBeInTheDocument();
    expect(screen.getByText('(2)')).toBeInTheDocument();
    expect(screen.getByText('Forbidden')).toBeInTheDocument();
    expect(onFilesChanged).not.toHaveBeenCalled();
    window.removeEventListener('dripl:files-changed', onFilesChanged);
  });

  /**
   * Regression: deleting the last canvas on the account has to fall through to
   * `FileBrowser`'s empty state, CTA included. If the parent kept the emptied
   * array but something stopped re-rendering, the user is left staring at a tile
   * for a canvas the server has already deleted.
   */
  it('falls through to the first-canvas empty state once the last row is gone', async () => {
    api.deleteFile.mockResolvedValue(undefined);
    renderDashboard({ files: [file(ALPHA, 'Alpha canvas')], total: 1 });

    await deleteRow('Alpha canvas');

    expect(screen.getByText(/no canvases yet/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  /**
   * Regression: a refused delete must leave the row *operable*, or the user has
   * no way to retry. The delete confirmation's latch in `FileBrowser` is
   * released by its close timer; this asserts the loop is closed end to end.
   */
  it('lets the user retry a delete that the server refused', async () => {
    api.deleteFile.mockRejectedValueOnce(new Error('Forbidden'));
    api.deleteFile.mockResolvedValueOnce(undefined);
    renderDashboard();

    await deleteRow('Alpha canvas');
    expect(screen.getByText('Forbidden')).toBeInTheDocument();

    await deleteRow('Alpha canvas');

    expect(api.deleteFile).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('link', { name: /alpha canvas/i })).not.toBeInTheDocument();
  });

  /**
   * Regression: deleting must keep working after a successful delete. A latch
   * consumed by the first confirmation turns the control into a no-op for the
   * rest of the page's life.
   */
  it('keeps deleting after one has already succeeded', async () => {
    api.deleteFile.mockResolvedValue(undefined);
    renderDashboard();

    await deleteRow('Alpha canvas');
    await deleteRow('Beta canvas');

    expect(api.deleteFile).toHaveBeenNthCalledWith(1, ALPHA);
    expect(api.deleteFile).toHaveBeenNthCalledWith(2, BETA);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  /** Regression: the fallback message keeps a non-Error rejection readable. */
  it('falls back to a readable message for a non-Error delete rejection', async () => {
    api.deleteFile.mockRejectedValue(42);
    renderDashboard();

    await deleteRow('Alpha canvas');

    expect(screen.getByText('Failed to delete canvas')).toBeInTheDocument();
    expect(row('Alpha canvas')).toBeInTheDocument();
  });
});

describe('DashboardFiles — rename', () => {
  /** Regression: the rename is applied to one row, matched by id. */
  it('renames only the targeted row', async () => {
    api.updateFile.mockResolvedValue({ file: file(ALPHA, 'Alpha renamed') });
    renderDashboard();

    renameRow('Alpha canvas', 'Alpha renamed');
    await settle();

    expect(api.updateFile).toHaveBeenCalledWith(ALPHA, { name: 'Alpha renamed' });
    expect(row('Alpha renamed')).toBeInTheDocument();
    expect(row('Beta canvas')).toBeInTheDocument();
  });

  /**
   * Regression: the new name is written after the server accepts it. Writing it
   * first makes a rejected rename look successful until the next refetch snaps
   * the old name back.
   */
  it('leaves the old name in place when the rename is refused', async () => {
    api.updateFile.mockRejectedValue(new Error('Name taken'));
    renderDashboard();

    renameRow('Alpha canvas', 'Alpha renamed');
    await settle();

    expect(screen.getByText('Name taken')).toBeInTheDocument();
    expect(screen.getByText('Alpha canvas')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Alpha renamed')).not.toBeInTheDocument();
  });

  /** Regression: the fallback message keeps a non-Error rejection readable. */
  it('falls back to a readable message for a non-Error rename rejection', async () => {
    api.updateFile.mockRejectedValue('nope');
    renderDashboard();

    renameRow('Alpha canvas', 'Alpha renamed');
    await settle();

    expect(screen.getByText('Failed to rename canvas')).toBeInTheDocument();
    expect(screen.getByText('Alpha canvas')).toBeInTheDocument();
  });

  /**
   * Regression: each handler clears `actionError` on entry. Without that a
   * stale banner from an earlier failure sits above the list forever, claiming
   * a failure that has since been resolved.
   */
  it('clears an earlier failure banner when the next action succeeds', async () => {
    api.deleteFile.mockRejectedValue(new Error('Forbidden'));
    api.updateFile.mockResolvedValue({ file: file(BETA, 'Beta renamed') });
    renderDashboard();

    await deleteRow('Alpha canvas');
    expect(screen.getByText('Forbidden')).toBeInTheDocument();

    renameRow('Beta canvas', 'Beta renamed');
    await settle();

    expect(screen.queryByText('Forbidden')).not.toBeInTheDocument();
  });
});

describe('DashboardFiles — empty state', () => {
  /**
   * Regression: the empty list still has to be actionable. `FileBrowser` gates
   * its controls on the handlers it is given, so a dropped `onStartNewCanvas`
   * turns the "create your first canvas" CTA into an enabled no-op.
   */
  it('offers a working create action on an empty account', async () => {
    api.createFile.mockResolvedValue({ id: 'first', name: 'Untitled canvas' });
    renderDashboard({ files: [], total: 0 });

    expect(screen.getByText(/no canvases yet/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /create your first canvas/i }));
    await settle();

    expect(api.createFile).toHaveBeenCalledTimes(1);
  });

  /**
   * Regression: the empty state and the failure banner are different messages
   * for different situations. Rendering one for the other tells a user with no
   * canvases that their last action failed.
   */
  it('does not show an error banner on a fresh empty account', () => {
    renderDashboard({ files: [], total: 0 });

    expect(screen.getByText(/no canvases yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/failed to/i)).not.toBeInTheDocument();
  });
});
