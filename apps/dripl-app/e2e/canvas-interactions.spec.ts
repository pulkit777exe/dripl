import { expect, test } from '@playwright/test';
import {
  canvasBox,
  drawRectangle,
  expectElementCount,
  openFreshCanvas,
  persistedElements,
  selectTool,
  toolButton,
} from './helpers/canvas';

/**
 * Real-browser coverage for the canvas input path: tool keyboard shortcuts,
 * pointer drawing, Escape cancellation, keyboard deletion and history.
 *
 * The gap these close is the one the audit names: no browser pass ever
 * exercised pointer and keyboard flows, only partial persistence in the
 * performance spec.
 */

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

    await drawRectangle(page);
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

    await selectTool(page, 'r', 'Rectangle');
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

    await drawRectangle(page);
    await expectElementCount(page, 1);

    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Delete');
    await expectElementCount(page, 0);
  });
});

test.describe('canvas history', () => {
  test('undoes and redoes a drawn rectangle', async ({ page }) => {
    await openFreshCanvas(page);

    await drawRectangle(page);
    await expectElementCount(page, 1);

    await page.keyboard.press('ControlOrMeta+z');
    await expectElementCount(page, 0);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expectElementCount(page, 1);
  });
});

test.describe('canvas modals', () => {
  test('opens the command palette from the keyboard and closes it with Escape', async ({
    page,
  }) => {
    await openFreshCanvas(page);

    const palette = page.getByRole('dialog', { name: 'Command palette' });
    // HelpModal's h2, which only renders while Help is open.
    const helpHeading = page.getByRole('heading', { name: 'Help' });
    await expect(palette).toBeHidden();

    await page.keyboard.press('ControlOrMeta+/');
    await expect(palette).toBeVisible();
    // Ctrl+/ is the command-palette chord the menu advertises; it must not also
    // open Help (the page used to bind the same chord to both).
    await expect(helpHeading).toBeHidden();

    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
  });
});
