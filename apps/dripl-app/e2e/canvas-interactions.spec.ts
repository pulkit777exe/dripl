import { expect, test, type Page } from '@playwright/test';

/**
 * Real-browser coverage for the canvas input path: tool keyboard shortcuts,
 * pointer drawing, Escape cancellation, and keyboard deletion.
 *
 * These assert observable *outcomes* — the toolbar's pressed state and the
 * scene the app persisted — not pixels. A screenshot diff would add a second,
 * flakier axis (font loading, DPR, antialiasing) on top of the behavior this
 * is meant to pin; the byte-exact SVG goldens already cover rendering
 * determinism. The gap these close is the one the audit names: no browser pass
 * ever exercised pointer and keyboard flows, only partial persistence in the
 * performance spec.
 *
 * The spec is dev/prod agnostic: it uses only the unauthenticated local canvas
 * (`/canvas`), so it runs under the dev webServer and against the production
 * container via `E2E_BASE_URL` alike.
 */

interface PersistedElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
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
async function openFreshCanvas(page: Page): Promise<void> {
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
async function persistedElements(page: Page): Promise<PersistedElement[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('dripl-canvas', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const record = await new Promise<{ elements?: PersistedElement[] } | undefined>(
      (resolve, reject) => {
        const tx = db.transaction('canvas-rooms', 'readonly');
        const get = tx.objectStore('canvas-rooms').get('local-canvas');
        get.onsuccess = () => resolve(get.result as { elements?: PersistedElement[] } | undefined);
        get.onerror = () => reject(get.error);
      }
    );
    db.close();
    return Array.isArray(record?.elements) ? record.elements : [];
  });
}

/** Persistence is debounced (500 ms); poll rather than sleep a fixed guess. */
async function expectElementCount(page: Page, count: number): Promise<void> {
  await expect
    .poll(() => persistedElements(page).then(elements => elements.length), {
      timeout: 10_000,
    })
    .toBe(count);
}

async function canvasBox(page: Page) {
  const canvas = page.locator('canvas').last();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('canvas has no layout box');
  return box;
}

const toolButton = (page: Page, label: string) =>
  page.getByRole('button', { name: `${label} tool`, exact: true });

test.describe('canvas tool shortcuts', () => {
  test('reflects letter and numeric shortcuts in the toolbar', async ({ page }) => {
    await openFreshCanvas(page);

    await page.keyboard.press('r');
    await expect(toolButton(page, 'Rectangle')).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('o');
    await expect(toolButton(page, 'Ellipse')).toHaveAttribute('aria-pressed', 'true');
    await expect(toolButton(page, 'Rectangle')).toHaveAttribute('aria-pressed', 'false');

    await page.keyboard.press('1');
    await expect(toolButton(page, 'Selection')).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('canvas pointer drawing', () => {
  test('draws a rectangle with the pointer and persists it', async ({ page }) => {
    await openFreshCanvas(page);

    await page.keyboard.press('r');
    const box = await canvasBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.mouse.move(cx - 80, cy - 60);
    await page.mouse.down();
    await page.mouse.move(cx + 80, cy + 60, { steps: 10 });
    await page.mouse.up();

    await expectElementCount(page, 1);
    const [element] = await persistedElements(page);
    expect(element?.type).toBe('rectangle');
    // The drag defined the box: a 160x120 screen-space draw at zoom 1.
    expect(element?.width).toBeGreaterThan(100);
    expect(element?.height).toBeGreaterThan(60);

    // Drawing once reverts to the selection tool (tool lock is off by default),
    // so the next click does not start another shape.
    await expect(toolButton(page, 'Selection')).toHaveAttribute('aria-pressed', 'true');
  });

  test('Escape cancels an in-progress draw without committing it', async ({ page }) => {
    await openFreshCanvas(page);

    await page.keyboard.press('r');
    const box = await canvasBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.mouse.move(cx - 80, cy - 60);
    await page.mouse.down();
    await page.mouse.move(cx + 80, cy + 60, { steps: 10 });
    await page.keyboard.press('Escape');
    await page.mouse.up();

    // Give the (absent) persistence debounce more than its window to fire.
    await page.waitForTimeout(800);
    await expectElementCount(page, 0);
  });
});

test.describe('canvas keyboard deletion', () => {
  test('selects all and deletes through the keyboard', async ({ page }) => {
    await openFreshCanvas(page);

    await page.keyboard.press('r');
    const box = await canvasBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx - 80, cy - 60);
    await page.mouse.down();
    await page.mouse.move(cx + 80, cy + 60, { steps: 10 });
    await page.mouse.up();
    await expectElementCount(page, 1);

    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Delete');
    await expectElementCount(page, 0);
  });
});
