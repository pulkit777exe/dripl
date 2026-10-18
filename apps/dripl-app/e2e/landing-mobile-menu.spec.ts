import { expect, test } from '@playwright/test';

/**
 * The landing navbar is the app's only responsive menu: below `md` the desktop
 * links and CTAs are hidden and a hamburger toggles a slide-down panel. The
 * audit lists "mobile menu flows" and "no verified responsive menu layout" as
 * unverified browser behavior, so these pin the swap and the ARIA/inert
 * contract — not pixels.
 */

test.describe('landing navbar — desktop', () => {
  test('shows desktop navigation and hides the mobile toggle', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('link', { name: 'Features' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeHidden();
  });
});

test.describe('landing navbar — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('shows the toggle, hides desktop navigation, and keeps the panel inert', async ({
    page,
  }) => {
    await page.goto('/');

    const toggle = page.getByRole('button', { name: 'Open menu' });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveAttribute('aria-controls', 'mobile-menu');

    // Desktop CTA is `display:none` at this width; it precedes the panel in DOM
    // order, so `.first()` is the desktop one.
    await expect(page.getByRole('link', { name: 'Get started free' }).first()).toBeHidden();

    const panel = page.locator('#mobile-menu');
    await expect(panel).toBeHidden();
    await expect(panel).toHaveAttribute('aria-hidden', 'true');
    await expect(panel).toHaveAttribute('inert', '');
  });

  test('opens the panel, then closes it with Escape', async ({ page }) => {
    await page.goto('/');

    const panel = page.locator('#mobile-menu');
    await page.getByRole('button', { name: 'Open menu' }).click();

    const toggle = page.getByRole('button', { name: 'Close menu' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('aria-hidden', 'false');
    await expect(panel).not.toHaveAttribute('inert', '');
    await expect(panel.getByRole('link', { name: 'Features' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open menu' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    await expect(panel).toBeHidden();
  });

  test('closes the panel after choosing a link', async ({ page }) => {
    await page.goto('/');

    const panel = page.locator('#mobile-menu');
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(panel).toBeVisible();

    await panel.getByRole('link', { name: 'Features' }).click();
    await expect(panel).toBeHidden();
  });
});
