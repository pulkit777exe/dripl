import { expect, test, type Page } from '@playwright/test';
import {
  canvasBox,
  expectElementCount,
  openFreshCanvas,
  persistedElements,
  selectTool,
  toolButton,
} from './helpers/canvas';

/**
 * Real-browser coverage for the image-insert tool, the one canvas flow that
 * leaves the app: the tool raises a file picker, the chosen file is uploaded,
 * and the returned URL is decoded before an element is committed.
 *
 * Two things are deliberately replaced, each for a stated reason:
 *
 *   - The upload cannot run against a real store here (the CI stack's Firebase
 *     credentials are placeholders and local runs have no http-server), so the
 *     CSRF bootstrap, the upload, and the image fetch are stubbed.
 *   - The native file dialog is replaced with a synthetic `change`. Chromium's
 *     dialog is not reliably observable under automation: the same click either
 *     fired `filechooser` or silently dropped it, run to run. The substitution
 *     still exercises the app's real path — the pointer handler creates the
 *     input, the handler runs, the upload is issued, the element is committed —
 *     and it *records* how the app raised the input, which is what pins the
 *     regression below.
 *
 * The recorded `connected` flag is a real assertion, not bookkeeping: the tool
 * used to click a detached `<input type=file>`, which Chromium silently refuses
 * to open on some clicks, so Insert Image intermittently did nothing.
 */

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

const UPLOADED_ID = 'e2e-image.png';

interface RaisedInput {
  accept: string;
  connected: boolean;
}

interface PickerProbe {
  raised: RaisedInput[];
}

/**
 * Replace the native dialog with a deterministic selection, and record how the
 * app raised the input. Must be installed before the app loads.
 */
async function stubFilePicker(page: Page): Promise<void> {
  await page.addInitScript(
    ({ b64, name }) => {
      const probe: PickerProbe = { raised: [] };
      (window as unknown as { __pickerProbe: PickerProbe }).__pickerProbe = probe;

      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], name, { type: 'image/png' });

      const originalClick = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function (this: HTMLInputElement) {
        if (this.type === 'file') {
          probe.raised.push({ accept: this.accept, connected: this.isConnected });
          const transfer = new DataTransfer();
          transfer.items.add(file);
          this.files = transfer.files;
          this.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
        return originalClick.call(this);
      };
    },
    { b64: PNG_1x1.toString('base64'), name: 'picked.png' }
  );
}

async function raisedInputs(page: Page): Promise<RaisedInput[]> {
  return page.evaluate(
    () => (window as unknown as { __pickerProbe: PickerProbe }).__pickerProbe.raised
  );
}

/**
 * The app's API calls are credentialed (`credentials: 'include'`), so the
 * browser rejects a wildcard `Access-Control-Allow-Origin`: the response has to
 * echo the request's `Origin`. Stubs therefore mirror what a real server does
 * rather than answering `*`, which would silently fail the CORS check and look
 * like an app bug.
 *
 * A request with no `Origin` header (a same-origin fetch) gets no CORS headers
 * at all, which is also what a real server does.
 */
function corsFor(route: {
  request(): { headers(): Record<string, string> };
}): Record<string, string> {
  const origin = route.request().headers()['origin'];
  return origin
    ? {
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
      }
    : {};
}

/**
 * Fulfil exactly the image-pipeline requests; everything else passes.
 *
 * Routed at the *context* level, not the page: production registers
 * `public/sw.js`, and requests a service worker issues are invisible to
 * `page.route`. The worker deliberately leaves `/api/` alone but still handles
 * the bare `/csrf-token` bootstrap, so a page-level stub would let the worker's
 * offline fallback ("Offline", 503) reach the app instead.
 */
async function stubImageBackend(page: Page, uploadStatus = 200): Promise<void> {
  const context = page.context();
  // `apiClient.getCsrfToken()` GETs `/csrf-token` and reads `{ token }`.
  await context.route('**/csrf-token', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsFor(route),
      body: JSON.stringify({ token: 'e2e-csrf' }),
    })
  );

  await context.route('**/api/images', async route => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: uploadStatus,
      contentType: 'application/json',
      headers: corsFor(route),
      body:
        uploadStatus === 200
          ? JSON.stringify({ id: UPLOADED_ID, url: UPLOADED_ID, size: PNG_1x1.length })
          : JSON.stringify({ error: 'PAYLOAD_TOO_LARGE', message: 'Image too large.' }),
    });
  });

  // The committed element's `src` is fetched by `new Image()` while loading.
  await context.route(`**/api/images/${UPLOADED_ID}`, route =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1x1 })
  );
}

test.describe('canvas image insertion', () => {
  test('uploads a chosen file and persists an image element', async ({ page }) => {
    await stubFilePicker(page);
    await stubImageBackend(page);
    await openFreshCanvas(page);

    await selectTool(page, '9', 'Insert Image');

    const box = await canvasBox(page);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    await expectElementCount(page, 1);
    const [element] = await persistedElements(page);
    expect(element?.type).toBe('image');
    expect(element?.src).toContain(UPLOADED_ID);

    // The input must request images only, and must be connected before the
    // click — an unconnected input is silently refused by Chromium.
    expect(await raisedInputs(page)).toEqual([{ accept: 'image/*', connected: true }]);

    // As with shapes, one insertion hands the tool back to selection.
    await expect(toolButton(page, 'Selection')).toHaveAttribute('aria-pressed', 'true');
  });

  test('adds nothing when the upload is rejected', async ({ page }) => {
    await stubFilePicker(page);
    await stubImageBackend(page, 413);
    await openFreshCanvas(page);

    await selectTool(page, '9', 'Insert Image');

    const box = await canvasBox(page);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    // Give the (absent) persistence debounce more than its window to fire.
    await page.waitForTimeout(800);
    await expectElementCount(page, 0);
  });
});
