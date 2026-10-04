import { describe, expect, it } from 'vitest';
import type { DriplElement } from '@dripl/common';
import { escapeXml, exportToSvg, safeSvgPaint, safeSvgUrl } from '@/utils/export/vector';
import { linear, rectangle } from './helpers/elements';

/**
 * `utils/export/vector.ts` — the SVG half of "export this canvas".
 *
 * Two things are being defended here, and they are different in kind:
 *
 * 1. **Injectable content.** Everything interpolated into the markup goes
 *    through `escapeXml`, and paints and URLs through an allow-list. An SVG is
 *    an XML document that a browser will execute: an unescaped `&` makes the
 *    file unopenable, and an unfiltered `href` or `url()` paint makes it
 *    dangerous.
 * 2. **Geometry.** The emitted coordinates are the scene's *world* coordinates,
 *    offset by `viewBox`. Line and freedraw `points` are element-local, so
 *    forgetting `element.x/y` moves every path to the origin while every other
 *    assertion still passes.
 *
 * The last test parses the output back with `DOMParser` and compares world
 * coordinates, which is the round-trip that is meaningful for a rendering (the
 * scene-level round-trip belongs to `serialization.ts`, already covered by
 * `export.test.ts`).
 */

/**
 * `strokeWidth: 0` keeps `getSceneBounds` returning the elements' literal boxes —
 * it inflates by `strokeWidth / 2`, which would make every expected coordinate
 * in this file off by a pixel without testing anything.
 */
const STYLE = { strokeColor: '#1e1e1e', strokeWidth: 0, opacity: 1 };

function readBlob(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

async function svgOf(elements: DriplElement[], options = {}): Promise<string> {
  return readBlob(exportToSvg(elements, options));
}

/** Parse the SVG and fail with the parser's own complaint if it is malformed. */
async function parseSvg(elements: DriplElement[], options = {}): Promise<Document> {
  const markup = await svgOf(elements, options);
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const error = doc.querySelector('parsererror');
  expect(error?.textContent ?? null).toBeNull();
  return doc;
}

describe('escapeXml', () => {
  it('escapes the five XML metacharacters, ampersand first', () => {
    // Regression: `&` must be replaced first. Replaced later (or not at all),
    // the output for a text containing `&lt;` is `&amp;lt;` — literal "&lt;",
    // i.e. visible mojibake in the exported file — or `&lt;`, i.e. broken XML.
    expect(escapeXml('&lt;')).toBe('&amp;lt;');
    expect(escapeXml('<a href="x">')).toBe('&lt;a href=&quot;x&quot;&gt;');
    expect(escapeXml("it's")).toBe('it&apos;s');
    expect(escapeXml('plain')).toBe('plain');
  });
});

describe('safeSvgUrl', () => {
  it('allows same-origin paths and https URLs', () => {
    // Regression: these are the two sources `ImageSourceSchema` accepts for an
    // element, so rejecting either would blank an image in every export.
    expect(safeSvgUrl('/assets/logo.png')).toBe('/assets/logo.png');
    expect(safeSvgUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(safeSvgUrl('HTTPS://EXAMPLE.COM/a.png')).toBe('HTTPS://EXAMPLE.COM/a.png');
    // The raster data-URL form an embedded image is stored as. A mistyped
    // `;base64,` requirement rejects every embedded image in every export.
    expect(safeSvgUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(
      'data:image/png;base64,iVBORw0KGgo='
    );
  });

  it('rejects a protocol-relative URL, which points at another origin', () => {
    // Regression: `value.startsWith('/')` alone admits `//evil.example/x.png`.
    // An exported SVG is opened as a document, so that is a silent remote
    // reference — and it bypasses the file:// sandbox the path check implies.
    expect(safeSvgUrl('//evil.example/x.png')).toBe('');
  });

  it('rejects a non-raster data URL', () => {
    // Regression: allowing `data:image/svg+xml,...` (or any data: URL) lets an
    // imported scene carry a second, scriptable SVG inside the exported one.
    // The `;base64,` forms are the ones that actually reach the mime check.
    expect(safeSvgUrl('data:image/svg+xml;base64,PHN2Zy8+')).toBe('');
    expect(safeSvgUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe('');
    expect(safeSvgUrl('data:image/svg+xml,<svg onload="alert(1)"/>')).toBe('');
    expect(safeSvgUrl('data:text/html,<script>alert(1)</script>')).toBe('');
  });

  it('rejects an insecure http image URL, which drops the image from the export', () => {
    // Regression: `safeSvgUrl` allows https, local paths and raster data URLs
    // but not plain `http:`. `ImageSourceSchema` does accept http, so this is
    // the one image source the editor accepts and the SVG export silently
    // drops. Widening the allow-list to `http` must break this assertion.
    expect(safeSvgUrl('http://example.com/a.png')).toBe('');
  });

  it('rejects script and file URLs', () => {
    // Regression: an allow-list that forgot the scheme check would pass
    // `javascript:` through into the exported markup.
    expect(safeSvgUrl('javascript:alert(1)')).toBe('');
    expect(safeSvgUrl('file:///etc/passwd')).toBe('');
    expect(safeSvgUrl('data:image/png,notbase64')).toBe('');
  });
});

describe('safeSvgPaint', () => {
  it('accepts the colour forms the editor can produce', () => {
    // Regression: rejecting any of these falls back to `transparent`, so the
    // exported file loses its colours rather than failing loudly.
    for (const value of [
      '#000',
      '#1e1e1e',
      '#1e1e1e80',
      'transparent',
      'none',
      'rgb(1, 2, 3)',
      'rgba(1, 2, 3, 0.5)',
      'hsl(120, 50%, 50%)',
    ]) {
      expect(safeSvgPaint(value, 'FALLBACK')).toBe(value);
    }
    expect(safeSvgPaint('  #1e1e1e  ', 'FALLBACK')).toBe('#1e1e1e');
  });

  it('rejects a paint-server URL and anything that is not a plain colour', () => {
    // Regression: `url(#gradient)` and friends are the injection surface —
    // `url(javascript:...)` in a `fill` attribute is executable in some
    // renderers, and a value containing a quote would break out of the
    // attribute. Both must fall back.
    expect(safeSvgPaint('url(#gradient)', 'transparent')).toBe('transparent');
    expect(safeSvgPaint('url(javascript:alert(1))', 'transparent')).toBe('transparent');
    expect(safeSvgPaint('red" onload="alert(1)', 'transparent')).toBe('transparent');
    expect(safeSvgPaint('red; stroke:url(#x)', 'transparent')).toBe('transparent');
    expect(safeSvgPaint('', 'transparent')).toBe('transparent');
  });
});

describe('exportToSvg: document frame', () => {
  it('derives the viewBox from the scene bounds plus padding, keeping world coordinates', () => {
    // Regression: the `viewBox` origin is `minX - padding`. Dropping the
    // padding term (or the negation) shifts every element inside the file by 16
    // world units while the width/height still look right.
    return parseSvg([
      rectangle('a', { ...STYLE, x: 10, y: 20, width: 100, height: 60 }),
      rectangle('b', { ...STYLE, x: -30, y: 5, width: 40, height: 40 }),
    ]).then(doc => {
      const root = doc.documentElement;
      // bounds: x [-30, 110], y [5, 80]; padding 16 each side.
      expect(root.getAttribute('viewBox')).toBe('-46 -11 172 107');
      expect(root.getAttribute('width')).toBe('172');
      expect(root.getAttribute('height')).toBe('107');
      expect(root.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg');
    });
  });

  it('caps custom dimensions at 8192', async () => {
    // Regression: the cap keeps a bad dialog value from producing a file that
    // declares a 20000px canvas and then fails to rasterise.
    const markup = await svgOf([rectangle('a', { ...STYLE })], {
      customWidth: 20_000,
      customHeight: 20_000,
    });
    expect(markup).toContain('width="8192"');
    expect(markup).toContain('height="8192"');
  });
});

describe('exportToSvg: element geometry', () => {
  it('emits world coordinates for every shape, so the file round-trips', async () => {
    // Regression: the round-trip that matters for a rendering. A shape emitted
    // at element-local coordinates, or an ellipse whose `cx` is the element's
    // left edge instead of its centre, still produces a plausible-looking file.
    const doc = await parseSvg([
      rectangle('r', { ...STYLE, x: 10, y: 20, width: 100, height: 60 }),
      {
        ...rectangle('e', { ...STYLE, x: 200, y: 0, width: 90, height: 90 }),
        type: 'ellipse',
      } as unknown as DriplElement,
      linear(
        'l',
        'line',
        [
          { x: 0, y: 0 },
          { x: 60, y: 30 },
        ],
        { ...STYLE, x: 500, y: 500 }
      ) as DriplElement,
    ]);

    const rect = doc.querySelector('rect')!;
    expect([
      rect.getAttribute('x'),
      rect.getAttribute('y'),
      rect.getAttribute('width'),
      rect.getAttribute('height'),
    ]).toEqual(['10', '20', '100', '60']);

    const ellipse = doc.querySelector('ellipse')!;
    expect([
      ellipse.getAttribute('cx'),
      ellipse.getAttribute('cy'),
      ellipse.getAttribute('rx'),
      ellipse.getAttribute('ry'),
    ]).toEqual(['245', '45', '45', '45']);

    // `points` are element-local, so the path must be offset by x/y or every
    // line in the file collapses onto the element's origin.
    const path = doc.querySelector('path')!;
    expect(path.getAttribute('d')).toBe('M 500 500 L 560 530');
    expect(path.getAttribute('fill')).toBe('none');
  });

  it('emits a diamond as a four-point polygon in top/right/bottom/left order', async () => {
    // Regression: any other winding is still a diamond-shaped `points` string to
    // a naive assertion, but renders as a self-intersecting bowtie.
    const doc = await parseSvg([
      {
        ...rectangle('d', { ...STYLE, x: 0, y: 0, width: 100, height: 60 }),
        type: 'diamond',
      } as unknown as DriplElement,
    ]);

    const polygon = doc.querySelector('polygon')!;
    expect(polygon.getAttribute('points')).toBe('50,0 100,30 50,60 0,30');
  });

  it('fills an arrow but leaves a line unfilled', async () => {
    // Regression: line and arrow share the path branch; giving a line its
    // element's fill colour paints a filled blob along every connector.
    const doc = await parseSvg([
      {
        ...linear(
          'a',
          'arrow',
          [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
          ],
          { ...STYLE, fillColor: '#ff0000' }
        ),
      } as unknown as DriplElement,
      {
        ...linear(
          'l',
          'line',
          [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
          ],
          { ...STYLE, fillColor: '#ff0000' }
        ),
      } as unknown as DriplElement,
    ]);

    const [arrow, line] = Array.from(doc.querySelectorAll('path'));
    expect(arrow!.getAttribute('fill')).toBe('#ff0000');
    expect(line!.getAttribute('fill')).toBe('none');
  });

  it('emits text with the anchor and baseline implied by its alignment', async () => {
    // Regression: `text-anchor` and the `tspan` x must agree, or every centred
    // or right-aligned label in the export hangs off its shape. Also covers the
    // `fontSize || 20` and `fontFamily || default` fallbacks.
    const doc = await parseSvg([
      {
        ...rectangle('c', { ...STYLE, x: 0, y: 0, width: 100, height: 60 }),
        type: 'text',
        text: 'A\nB',
        originalText: 'A\nB',
      } as unknown as DriplElement,
      {
        ...rectangle('r', { ...STYLE, x: 200, y: 0, width: 100, height: 60 }),
        type: 'text',
        text: 'right',
        originalText: 'right',
        textAlign: 'right',
      } as unknown as DriplElement,
      {
        ...rectangle('d', { ...STYLE, x: 400, y: 0, width: 100, height: 60 }),
        type: 'text',
        text: 'centre',
        originalText: 'centre',
        textAlign: 'center',
        fontSize: 10,
      } as unknown as DriplElement,
    ]);

    const texts = Array.from(doc.querySelectorAll('text'));
    expect(texts[0]!.getAttribute('text-anchor')).toBe('start');
    expect(texts[0]!.getAttribute('font-size')).toBe('20');
    // fontFamily absent → the default preference, escaped for the attribute.
    expect(texts[0]!.getAttribute('font-family')).toContain('cursive');
    const spans = Array.from(texts[0]!.querySelectorAll('tspan'));
    expect(spans.map(span => span.textContent)).toEqual(['A', 'B']);
    // Baseline of the first line is y + fontSize; line height is 1.25 * fontSize.
    expect(spans.map(span => span.getAttribute('y'))).toEqual(['20', '45']);

    expect(texts[1]!.getAttribute('text-anchor')).toBe('end');
    expect(Array.from(texts[1]!.querySelectorAll('tspan'))[0]!.getAttribute('x')).toBe('300');
    expect(texts[2]!.getAttribute('text-anchor')).toBe('middle');
    expect(texts[2]!.getAttribute('font-size')).toBe('10');
    expect(Array.from(texts[2]!.querySelectorAll('tspan'))[0]!.getAttribute('x')).toBe('450');
  });

  it('escapes element text so the file stays parseable', async () => {
    // Regression: text is user input. An unescaped `&` or `<` makes the whole
    // export unopenable — the drawing is not lost, it simply cannot be shown.
    const doc = await parseSvg([
      {
        ...rectangle('t', { ...STYLE, x: 0, y: 0, width: 100, height: 60 }),
        type: 'text',
        text: 'a & b <c> "d" \'e\'',
        originalText: 'a & b <c> "d" \'e\'',
      } as unknown as DriplElement,
      // A text element with no `text` at all — an older scene, or a partially
      // built one. The `|| ''` fallback is what keeps this from throwing and
      // taking the whole export with it.
      {
        ...rectangle('blank', { ...STYLE, x: 200, y: 0, width: 100, height: 60 }),
        type: 'text',
        text: undefined,
      } as unknown as DriplElement,
    ]);

    const texts = Array.from(doc.querySelectorAll('text'));
    expect(texts[0]!.textContent).toBe('a & b <c> "d" \'e\'');
    expect(texts[1]!.textContent).toBe('');
    expect(texts[1]!.querySelectorAll('tspan')).toHaveLength(1);
  });

  it('links an image only when its URL passes the allow-list', async () => {
    // Regression: an unsafe `src` must drop the element, not emit an `href` the
    // viewer would fetch. Both cases are decided by `safeSvgUrl`.
    const doc = await parseSvg([
      {
        ...rectangle('safe', { ...STYLE, x: 0, y: 0, width: 40, height: 40 }),
        type: 'image',
        src: '/assets/a.png',
      } as unknown as DriplElement,
      {
        ...rectangle('unsafe', { ...STYLE, x: 100, y: 0, width: 40, height: 40 }),
        type: 'image',
        src: 'javascript:alert(1)',
      } as unknown as DriplElement,
      {
        ...rectangle('empty', { ...STYLE, x: 200, y: 0, width: 40, height: 40 }),
        type: 'image',
        src: '',
      } as unknown as DriplElement,
    ]);

    const images = Array.from(doc.querySelectorAll('image'));
    expect(images).toHaveLength(1);
    expect(images[0]!.getAttribute('href')).toBe('/assets/a.png');
  });

  it('exports a frame as the rectangle the renderer draws', async () => {
    // Regression: `frame` is a real editor tool (shortcut F, `ExtraToolsDropdown`)
    // and a valid scene type, and `rough-renderer.ts` draws it as a plain
    // rectangle. It used to fall through to `return ''`, so drawing a frame and
    // exporting to SVG produced a file with a hole where it was -- silently, since
    // the rest of the scene exported fine.
    //
    // Asserted through a real parse, and against the same shape the renderer
    // emits, so this is about the element surviving rather than about one string.
    const frame = {
      ...rectangle('frame', { ...STYLE, x: 10, y: 20, width: 400, height: 300 }),
      type: 'frame',
      title: 'Flow',
    } as unknown as DriplElement;

    const doc = await parseSvg([frame]);
    const rect = doc.querySelector('rect');

    expect(rect).not.toBeNull();
    expect(rect!.getAttribute('x')).toBe('10');
    expect(rect!.getAttribute('y')).toBe('20');
    expect(rect!.getAttribute('width')).toBe('400');
    expect(rect!.getAttribute('height')).toBe('300');
  });

  it('exports an embed through its cached preview', async () => {
    // Regression: an embed is an iframe, which a static SVG cannot express -- but
    // it carries a `cachedPreview` image, and dropping it meant a user who pasted
    // a link saw nothing at all where the preview should be. The preview is run
    // through the same `safeSvgUrl` allow-list as any other image, so a
    // `javascript:` preview cannot become an `href`.
    const embed = {
      ...rectangle('embed', { ...STYLE, x: 0, y: 500, width: 200, height: 120 }),
      type: 'embed',
      url: 'https://example.com',
      cachedPreview: 'data:image/png;base64,AAA',
    } as unknown as DriplElement;

    const doc = await parseSvg([embed]);
    const image = doc.querySelector('image');

    expect(image).not.toBeNull();
    expect(image!.getAttribute('href')).toBe('data:image/png;base64,AAA');
    expect(image!.getAttribute('width')).toBe('200');
  });

  it('omits an embed with no preview rather than emitting an unusable one', async () => {
    // The control for the test above. With nothing to show there is no faithful
    // output -- an `<iframe>` is not valid SVG content and a bare placeholder rect
    // would be a drawing the user never made. Dropping it is correct; the rest of
    // the scene must still survive.
    const embed = {
      ...rectangle('embed', { ...STYLE, x: 0, y: 500, width: 200, height: 120 }),
      type: 'embed',
      url: 'https://example.com',
    } as unknown as DriplElement;

    const doc = await parseSvg([embed, rectangle('kept', { ...STYLE })]);

    expect(doc.querySelector('image')).toBeNull();
    expect(doc.querySelectorAll('rect').length).toBe(1);
  });

  it('rejects an embed preview that is not an allowed image URL', async () => {
    // Regression: the preview is attacker-influenced data reaching an `href`. It
    // goes through `safeSvgUrl`, so a `javascript:` or `data:text/html` preview is
    // dropped rather than becoming a live reference in the exported file.
    const embed = {
      ...rectangle('embed', { ...STYLE, x: 0, y: 0, width: 200, height: 120 }),
      type: 'embed',
      url: 'https://example.com',
      cachedPreview: 'javascript:alert(1)',
    } as unknown as DriplElement;

    const doc = await parseSvg([embed]);

    expect(doc.querySelector('image')).toBeNull();
    expect(doc.documentElement.getAttribute('href')).toBeNull();
  });

  it('omits an element it cannot represent without harming the rest of the file', async () => {
    // Regression: a scene can still contain something with no SVG equivalent --
    // this uses a `text` element with no `points`, which matches neither the text
    // arm nor the path arm and falls to `return ''`. The rest of the scene must
    // survive, and the markup must stay well-formed.
    //
    // This test used `frame` and `embed`, which *were* genuinely dropped and are
    // now exported; see the two tests below for those.
    const doc = await parseSvg([
      {
        ...rectangle('unrepresentable', { ...STYLE, x: 0, y: 0, width: 400, height: 400 }),
        type: 'text',
        text: 'no points, no text arm',
        points: [],
      } as unknown as DriplElement,
      {
        ...rectangle('kept', { ...STYLE, x: 0, y: 700, width: 50, height: 50 }),
        type: 'not-a-real-type',
      } as unknown as DriplElement,
      rectangle('real', { ...STYLE, x: 100, y: 700, width: 50, height: 50 }),
    ]);

    expect(Array.from(doc.querySelectorAll('rect')).map(node => node.getAttribute('x'))).toEqual([
      '100',
    ]);
  });

  it('keeps scene order and is byte-identical for the same scene', async () => {
    // Regression: output assembled through a `Map`/`Set` keyed on something
    // order-independent would reorder the file between exports, so "export
    // twice and diff" stops being a valid way to check an export.
    const scene = [
      rectangle('c', { ...STYLE, x: 40, y: 0, width: 10, height: 10 }),
      rectangle('a', { ...STYLE, x: 0, y: 0, width: 10, height: 10 }),
      rectangle('b', { ...STYLE, x: 20, y: 0, width: 10, height: 10 }),
    ];

    const first = await svgOf(scene);
    const second = await svgOf([...scene].map(element => ({ ...element })));

    expect(second).toBe(first);
    // Scene order is x = 40, 0, 20 — deliberately not the id order, so an
    // export that re-sorts by id is caught here too.
    expect(first.indexOf('x="40"')).toBeLessThan(first.indexOf('x="0"'));
    expect(first.indexOf('x="0"')).toBeLessThan(first.indexOf('x="20"'));
  });
});
