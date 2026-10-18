import { expect, type Page } from '@playwright/test';

/**
 * Shared drivers for the canvas e2e specs.
 *
 * The specs assert observable *outcomes* — the toolbar's pressed state and the
 * scene the app persisted — not pixels. A screenshot diff would add a second,
 * flakier axis (font loading, DPR, antialiasing) on top of the behavior under
 * test; the byte-exact SVG goldens already cover render determinism.
 *
 * Everything here uses only the unauthenticated local canvas (`/canvas`), so the
 * specs run under the dev webServer and against the production container via
 * `E2E_BASE_URL` alike.
 */

export interface PersistedElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  src?: string;
}

/**
 * Seed an empty local room and open the canvas.
 *
 * Preferences go into localStorage and the (empty) scene into IndexedDB,
 * mirroring how the app persists a local canvas. Wiping the IndexedDB row
 * first means the bootstrap cannot restore a previous test's scene; each test
 * gets a fresh browser context anyway, but the explicit delete documents the
 * isolation the assertions rely on.
 */
export async function openFreshCanvas(page: Page): Promise<void> {
  await page.goto('/login');
  await page.evaluate(async () => {
    localStorage.clear();
    localStorage.setItem(
      'dripl:local-canvas',
      JSON.stringify({
        userPreferences: {
          theme: 'light',
          zoom: 1,
          panX: 0,
          panY: 0,
          currentStrokeColor: '#1e1e1e',
          currentBackgroundColor: 'transparent',
          currentStrokeWidth: 2,
          currentRoughness: 1,
          currentStrokeStyle: 'solid',
          currentFillStyle: 'hachure',
          activeTool: 'select',
        },
        elementStates: { elements: [] },
      })
    );
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('dripl-canvas', 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('canvas-rooms')) {
          db.createObjectStore('canvas-rooms', { keyPath: 'roomId' });
        }
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('canvas-rooms', 'readwrite');
        tx.objectStore('canvas-rooms').delete('local-canvas');
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });

  await page.goto('/canvas');
  await expect(page.getByRole('toolbar', { name: 'Drawing tools' })).toBeVisible();
  await expect(page.locator('canvas').last()).toBeVisible();

  // The welcome card sits over the centre of an empty scene and would swallow
  // the first drag. It is lazy-loaded, so it is not necessarily in the DOM when
  // the toolbar is — wait for it rather than sampling once and skipping.
  const dismiss = page.getByRole('button', { name: 'Close welcome screen' });
  await expect(dismiss).toBeVisible();
  await dismiss.click();
  await expect(dismiss).toBeHidden();

  // The dismiss handler is React state; settle a frame so the empty canvas is
  // the top pointer target before the drag begins.
  await page.waitForTimeout(300);
}

/** The persisted scene for the local room, as the app stores it. */
export async function persistedElements(page: Page): Promise<PersistedElement[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('dripl-canvas', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const record = await new Promise<{ elements?: unknown[] } | undefined>((resolve, reject) => {
      const tx = db.transaction('canvas-rooms', 'readonly');
      const get = tx.objectStore('canvas-rooms').get('local-canvas');
      get.onsuccess = () => resolve(get.result as { elements?: unknown[] } | undefined);
      get.onerror = () => reject(get.error);
    });
    db.close();
    return (Array.isArray(record?.elements) ? record.elements : []) as never[];
  });
}

/** Persistence is debounced (500 ms); poll rather than sleep a fixed guess. */
export async function expectElementCount(page: Page, count: number): Promise<void> {
  await expect
    .poll(() => persistedElements(page).then(elements => elements.length), {
      timeout: 10_000,
    })
    .toBe(count);
}

export async function canvasBox(page: Page) {
  const canvas = page.locator('canvas').last();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('canvas has no layout box');
  return box;
}

export const toolButton = (page: Page, label: string) =>
  page.getByRole('button', { name: `${label} tool`, exact: true });

/**
 * Press a tool shortcut and wait for React to reflect it. A bare
 * `keyboard.press` races the commit: the next pointer event can still be
 * dispatched with the previous tool, which then handles the press.
 */
export async function selectTool(page: Page, key: string, label: string): Promise<void> {
  await page.keyboard.press(key);
  await expect(toolButton(page, label)).toHaveAttribute('aria-pressed', 'true');
}

/** Draw a rectangle from the canvas centre; leaves the selection tool active. */
export async function drawRectangle(page: Page): Promise<void> {
  await selectTool(page, 'r', 'Rectangle');
  const box = await canvasBox(page);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 80, cy - 60);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy + 60, { steps: 10 });
  await page.mouse.up();
}
