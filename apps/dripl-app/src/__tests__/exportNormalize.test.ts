import { describe, expect, it } from 'vitest';
import {
  finiteNumber,
  isJsonRecord,
  isSafeHttpUrl,
  isSafeImageSource,
  normalizeImportedElement,
  normalizePoints,
  remapElementReferences,
} from '@/utils/export/normalize';
import type { DriplElement } from '@dripl/common';

/**
 * The import normalizer: the boundary where an untrusted `.dripl` payload becomes a
 * live canvas element.
 *
 * Every branch here either rejects something or substitutes a default, so the tests are
 * written as "this input is refused" and "this input yields this default" rather than
 * as round-trip snapshots. A snapshot would pass for a payload that happened to be
 * normalized wrongly in the same way the fixture was built.
 */

/** A minimal valid rectangle, so each test can vary exactly one field. */
const rect = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  type: 'rectangle',
  x: 5,
  y: 6,
  width: 20,
  height: 30,
  ...over,
});

const imported = (over: Record<string, unknown> = {}, files: Record<string, unknown> = {}) =>
  normalizeImportedElement(rect(over), files);

describe('isJsonRecord', () => {
  it('accepts a plain object and rejects the look-alikes', () => {
    expect(isJsonRecord({})).toBe(true);
    // An array is an object, and a null-typed value would throw on property access
    // downstream, so both must be excluded.
    expect(isJsonRecord([])).toBe(false);
    expect(isJsonRecord(null)).toBe(false);
    expect(isJsonRecord('x')).toBe(false);
  });
});

describe('finiteNumber', () => {
  it('passes a finite number through', () => {
    expect(finiteNumber(4.5, 0)).toBe(4.5);
  });

  it('coerces a numeric string', () => {
    expect(finiteNumber('7', 0)).toBe(7);
  });

  /**
   * `finiteNumber` is `Number(value)` guarded by `Number.isFinite`, so whether the
   * fallback applies is decided entirely by `Number()`'s coercion rules. Spelled out as
   * an explicit table rather than `it.each` of bare values, because `it.each` spreads an
   * array argument into separate parameters -- a `[]` case silently becomes a
   * zero-argument case and asserts against `undefined` instead of `[]`.
   */
  it.each([
    { input: Number.NaN, expected: -1, why: 'NaN is not finite' },
    { input: Number.POSITIVE_INFINITY, expected: -1, why: 'infinity is not finite' },
    { input: Number.NEGATIVE_INFINITY, expected: -1, why: 'infinity is not finite' },
    { input: 'not a number', expected: -1, why: 'unparseable string' },
    { input: undefined, expected: -1, why: 'Number(undefined) is NaN' },
    { input: {}, expected: -1, why: 'Number({}) is NaN' },
    { input: [1, 2], expected: -1, why: "'1,2' is unparseable" },
    // The coercions below all look like they should fall back and do not. Recorded
    // because a null or empty-array geometry field becomes a real number rather than
    // the default the caller asked for.
    { input: null, expected: 0, why: 'Number(null) is 0' },
    { input: false, expected: 0, why: 'Number(false) is 0' },
    { input: [], expected: 0, why: "[].toString() is '', so 0" },
    { input: '', expected: 0, why: 'empty string is 0' },
    { input: '  ', expected: 0, why: 'whitespace trims to empty' },
    { input: true, expected: 1, why: 'Number(true) is 1' },
    { input: [5], expected: 5, why: "[5].toString() is '5'" },
  ])('finiteNumber($input) -> $expected ($why)', ({ input, expected }) => {
    expect(finiteNumber(input, -1)).toBe(expected);
  });

  it('throws for a Symbol, because Number() does', () => {
    // Not a fallback case: `Number(symbol)` raises a TypeError rather than returning
    // NaN, so it propagates out of normalization instead of degrading. Recorded so the
    // boundary between "falls back" and "throws" is explicit.
    expect(() => finiteNumber(Symbol('x'), -1)).toThrow(TypeError);
  });
});

describe('normalizePoints', () => {
  it('accepts tuple points', () => {
    expect(
      normalizePoints(
        [
          [0, 0],
          [10, 20],
        ],
        2
      )
    ).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 20 },
    ]);
  });

  it('accepts object points', () => {
    expect(
      normalizePoints(
        [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
        2
      )
    ).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
  });

  it('coerces numeric strings inside points', () => {
    expect(normalizePoints([['3', '4']], 1)).toEqual([{ x: 3, y: 4 }]);
  });

  it('rejects a point with a non-finite coordinate', () => {
    // `finiteNumber(x, NaN)` makes the sentinel indistinguishable from a real NaN, so
    // this is the only thing standing between a NaN coordinate and the canvas.
    expect(
      normalizePoints(
        [
          [0, 0],
          [Number.NaN, 5],
        ],
        2
      )
    ).toBeNull();
    expect(
      normalizePoints(
        [
          [0, 0],
          [5, 'abc'],
        ],
        2
      )
    ).toBeNull();
  });

  it('rejects a non-array and a wrong-length array', () => {
    expect(normalizePoints('nope', 2)).toBeNull();
    expect(normalizePoints([{ x: 0, y: 0 }], 2)).toBeNull();
  });

  it('rejects a point that is neither a tuple nor an object', () => {
    expect(normalizePoints([[0, 0], 42], 2)).toBeNull();
  });

  it('rejects an absurdly long point list', () => {
    // The cap exists so a hostile file cannot allocate without bound on import.
    const many = Array.from({ length: 20_001 }, () => [0, 0]);
    expect(normalizePoints(many, 1)).toBeNull();
  });

  it('honours a minimum length of one', () => {
    expect(normalizePoints([[0, 0]], 1)).toEqual([{ x: 0, y: 0 }]);
    expect(normalizePoints([[0, 0]], 2)).toBeNull();
  });
});

describe('isSafeImageSource', () => {
  it('accepts an absolute path', () => {
    expect(isSafeImageSource('/uploads/a.png')).toBe(true);
  });

  it('rejects a protocol-relative path', () => {
    // `//evil.example/x.png` is not a path, it is a host. Allowing it would let an
    // imported file point an <img> at an attacker's server.
    expect(isSafeImageSource('//evil.example/x.png')).toBe(false);
  });

  it.each([
    'data:image/png;base64,AAAA',
    'data:image/jpeg;base64,AAAA',
    'data:image/gif;base64,AAAA',
    'data:image/webp;base64,AAAA',
  ])('accepts a base64 image data URL: %s', value => {
    expect(isSafeImageSource(value)).toBe(true);
  });

  it.each([
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/svg+xml;base64,AAAA',
    'data:image/png,notbase64',
  ])('rejects a non-image or non-base64 data URL: %s', value => {
    expect(isSafeImageSource(value)).toBe(false);
  });

  it('accepts an absolute http(s) URL', () => {
    expect(isSafeImageSource('https://cdn.example/a.png')).toBe(true);
    expect(isSafeImageSource('http://cdn.example/a.png')).toBe(true);
  });

  it.each(['javascript:alert(1)', 'ftp://host/a.png', 'file:///etc/passwd', 'data:text/html,x'])(
    'rejects %s',
    value => {
      expect(isSafeImageSource(value)).toBe(false);
    }
  );

  it('rejects an unparseable value', () => {
    expect(isSafeImageSource('http://')).toBe(false);
  });
});

describe('isSafeHttpUrl', () => {
  it('accepts http and https', () => {
    expect(isSafeHttpUrl('https://example.com')).toBe(true);
    expect(isSafeHttpUrl('http://example.com')).toBe(true);
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd'])('rejects %s', v => {
    expect(isSafeHttpUrl(v)).toBe(false);
  });

  it('rejects an unparseable value', () => {
    expect(isSafeHttpUrl('not a url')).toBe(false);
  });
});

describe('normalizeImportedElement — rejection', () => {
  it('rejects a non-object payload', () => {
    expect(normalizeImportedElement(null, {})).toBeNull();
    expect(normalizeImportedElement('rectangle', {})).toBeNull();
    expect(normalizeImportedElement([], {})).toBeNull();
  });

  it('rejects an unknown element type', () => {
    expect(imported({ type: 'hologram' })).toBeNull();
  });

  it('maps the legacy type aliases', () => {
    expect(imported({ type: 'embeddable', url: 'https://example.com' })?.type).toBe('embed');
    expect(imported({ type: 'magicframe' })?.type).toBe('frame');
  });

  it('rejects a linear element with no usable points', () => {
    // A line or arrow without points renders as nothing but still occupies the scene,
    // so it is refused at the boundary instead.
    expect(imported({ type: 'line', points: undefined })).toBeNull();
    expect(imported({ type: 'line', points: [] })).toBeNull();
    expect(imported({ type: 'arrow', points: 'nope' })).toBeNull();
    // freedraw and path need only one point; line and arrow need a segment, so those
    // are the ones refused for having a single point.
    expect(imported({ type: 'freedraw', points: [[0, 0]] })).not.toBeNull();
    expect(imported({ type: 'path', points: [[0, 0]] })).not.toBeNull();
    expect(imported({ type: 'line', points: [[0, 0]] })).toBeNull();
  });

  it('rejects an image with no safe source', () => {
    expect(imported({ type: 'image', src: 'javascript:alert(1)' })).toBeNull();
    expect(imported({ type: 'image' })).toBeNull();
  });

  it('rejects an embed with no safe url', () => {
    expect(imported({ type: 'embed', url: 'javascript:alert(1)' })).toBeNull();
    expect(imported({ type: 'embed' })).toBeNull();
  });
});

describe('normalizeImportedElement — defaults', () => {
  it('defaults a missing geometry rather than importing NaN', () => {
    const out = imported({ x: 'abc', y: undefined, width: -5, height: 'wide' });
    expect(out).not.toBeNull();
    expect(out!.x).toBe(0);
    expect(out!.y).toBe(0);
    // Width and height are clamped at zero rather than left negative.
    expect(out!.width).toBe(0);
    expect(out!.height).toBe(100);
  });

  it('gives a line a 1px default extent instead of 100px', () => {
    // `width`/`height` must be omitted: the 1-vs-100 default only applies to a missing
    // value, so passing the base rectangle's 20x30 would never reach it.
    const out = normalizeImportedElement(
      {
        id: 'e1',
        type: 'line',
        points: [
          [0, 0],
          [5, 5],
        ],
      },
      {}
    );
    expect(out!.width).toBe(1);
    expect(out!.height).toBe(1);
  });

  it('keeps an explicit extent on a line rather than overriding it', () => {
    const out = imported({
      type: 'line',
      points: [
        [0, 0],
        [5, 5],
      ],
    });
    expect(out!.width).toBe(20);
    expect(out!.height).toBe(30);
  });

  it('mints an id when one is missing or empty', () => {
    const a = imported({ id: '' });
    const b = imported({});
    expect(a!.id).toBeTruthy();
    expect(b!.id).toBeTruthy();
    // Two imports of the same idless payload must not collide in one scene.
    expect(a!.id).not.toBe(b!.id);
  });

  it('falls back from fillColor to backgroundColor then transparent', () => {
    expect(imported({ backgroundColor: '#ff0000' })!.fillColor).toBe('#ff0000');
    expect(imported({ fillColor: '#00ff00', backgroundColor: '#ff0000' })!.fillColor).toBe(
      '#00ff00'
    );
    expect(imported()!.fillColor).toBe('transparent');
  });

  it('only accepts the known stroke styles', () => {
    expect(imported({ strokeStyle: 'dashed' })!.strokeStyle).toBe('dashed');
    expect(imported({ strokeStyle: 'dotted' })!.strokeStyle).toBe('dotted');
    expect(imported({ strokeStyle: 'wobbly' })!.strokeStyle).toBe('solid');
  });

  it('accepts only non-negative integer versions', () => {
    expect(imported({ version: 7 })!.version).toBe(7);
    expect(imported({ version: -1 })!.version).toBe(1);
    expect(imported({ version: 1.5 })!.version).toBe(1);
  });

  it('keeps a supplied versionNonce and mints one only when absent', () => {
    expect(imported({ versionNonce: 42 })!.versionNonce).toBe(42);
    expect(imported({ versionNonce: -1 })!.versionNonce).not.toBe(-1);
  });

  it('only treats an exact true as locked or deleted', () => {
    expect(imported({ locked: true })!.locked).toBe(true);
    expect(imported({ locked: 'true' })!.locked).toBe(false);
    expect(imported({ isDeleted: 1 })!.isDeleted).toBe(false);
  });
});

describe('normalizeImportedElement — legacy field names', () => {
  it('accepts `index` as a legacy fractionalIndex', () => {
    expect(imported({ index: 'a1' })!.fractionalIndex).toBe('a1');
  });

  it('prefers fractionalIndex over index', () => {
    expect(imported({ fractionalIndex: 'a2', index: 'a1' })!.fractionalIndex).toBe('a2');
  });

  it('accepts the first entry of a legacy groupIds array', () => {
    expect(imported({ groupIds: ['g1', 'g2'] })!.groupId).toBe('g1');
  });

  it('ignores an empty or non-string groupIds array', () => {
    expect(imported({ groupIds: [] })!.groupId).toBeUndefined();
    expect(imported({ groupIds: [7] })!.groupId).toBeUndefined();
  });

  it('maps a legacy frameId onto containerId', () => {
    expect(imported({ frameId: 'f1' })!.containerId).toBe('f1');
  });

  it('keeps a seed only when it is a number', () => {
    expect(imported({ seed: 7 })!.seed).toBe(7);
    expect(imported({ seed: '7' })!.seed).toBeUndefined();
  });
});

describe('normalizeImportedElement — bound elements', () => {
  it('keeps only arrow and text bindings', () => {
    // A bound element of any other type is meaningless to the renderer, and importing
    // it would leave a dangling reference in the scene graph.
    const out = imported({
      boundElements: [
        { id: 'b1', type: 'arrow' },
        { id: 'b2', type: 'text' },
        { id: 'b3', type: 'rectangle' },
        { id: 'b4' },
        'nope',
      ],
    });
    expect(out!.boundElements).toEqual([
      { id: 'b1', type: 'arrow' },
      { id: 'b2', type: 'text' },
    ]);
  });

  it('omits boundElements entirely when nothing survives', () => {
    const out = imported({ boundElements: [{ id: 'b', type: 'rectangle' }] });
    expect(out).not.toHaveProperty('boundElements');
  });
});

describe('normalizeImportedElement — arrows', () => {
  const arrow = (over: Record<string, unknown> = {}) =>
    imported({
      type: 'arrow',
      points: [
        [0, 0],
        [10, 10],
      ],
      ...over,
    });

  it.each(['curved', 'elbow', 'straight'])('accepts the %s arrowStyle', style => {
    expect(arrow({ arrowStyle: style })!.arrowStyle).toBe(style);
  });

  it('ignores an unknown arrowStyle', () => {
    expect(arrow({ arrowStyle: 'spiral' })!.arrowStyle).toBeUndefined();
  });

  it('promotes a legacy `elbowed` flag to arrowStyle', () => {
    expect(arrow({ elbowed: true })!.arrowStyle).toBe('elbow');
    expect(arrow({ elbowed: false })!.arrowStyle).toBeUndefined();
  });

  it('prefers an explicit arrowStyle over the legacy flag', () => {
    expect(arrow({ arrowStyle: 'curved', elbowed: true })!.arrowStyle).toBe('curved');
  });

  // Arrowhead values come from a closed enum in `@dripl/common`
  // (`triangle | dot | bar | diamond | none`). A fixture using anything else is rejected
  // by `ElementSchema` at the very end of normalization, so the whole element comes back
  // null and the assertion never runs.
  it('builds arrowHeads from the legacy start/end fields', () => {
    expect(arrow({ startArrowhead: 'triangle', endArrowhead: 'bar' })!.arrowHeads).toEqual({
      start: 'triangle',
      end: 'bar',
    });
  });

  it('omits the missing half of arrowHeads', () => {
    expect(arrow({ startArrowhead: 'triangle' })!.arrowHeads).toEqual({ start: 'triangle' });
  });

  it('prefers a structured arrowHeads object over the legacy fields', () => {
    expect(arrow({ arrowHeads: { start: 'dot' }, startArrowhead: 'triangle' })!.arrowHeads).toEqual(
      { start: 'dot' }
    );
  });

  it('rejects an arrowhead value outside the schema enum', () => {
    // The legacy field is not validated before being copied, so a bad value is caught
    // only by the final schema parse -- which discards the entire element.
    expect(arrow({ startArrowhead: 'arrow' })).toBeNull();
  });

  it('normalizes a binding with a default fixedPoint', () => {
    const out = arrow({ startBinding: { elementId: 'e9' } });
    expect(out!.startBinding).toEqual({
      elementId: 'e9',
      fixedPoint: { x: 0, y: 0 },
      mode: 'inside',
    });
  });

  it('normalizes a tuple fixedPoint and the orbit mode', () => {
    const out = arrow({
      endBinding: { elementId: 'e9', fixedPoint: [0.5, 0.25], mode: 'orbit' },
    });
    expect(out!.endBinding).toEqual({
      elementId: 'e9',
      fixedPoint: { x: 0.5, y: 0.25 },
      mode: 'orbit',
    });
  });

  it('defaults an unknown binding mode to inside', () => {
    const binding = arrow({ startBinding: { elementId: 'e9', mode: 'sideways' } })!.startBinding as
      { mode?: string } | undefined;
    expect(binding?.mode).toBe('inside');
  });

  it('drops a binding with no elementId', () => {
    expect(arrow({ startBinding: { fixedPoint: [0, 0] } })).not.toHaveProperty('startBinding');
    expect(arrow({ startBinding: 'nope' })).not.toHaveProperty('startBinding');
  });
});

describe('normalizeImportedElement — text', () => {
  const text = (over: Record<string, unknown> = {}) => imported({ type: 'text', ...over });

  it('defaults originalText to the text', () => {
    expect(text({ text: 'hi' })!.originalText).toBe('hi');
    expect(text({ text: 'hi', originalText: 'yo' })!.originalText).toBe('yo');
    expect(text({})!.text).toBe('');
  });

  it('floors the font size at 1', () => {
    expect(text({ fontSize: 0 })!.fontSize).toBe(1);
    expect(text({ fontSize: -20 })!.fontSize).toBe(1);
    expect(text({ fontSize: 32 })!.fontSize).toBe(32);
    expect(text({})!.fontSize).toBe(20);
  });

  it('only accepts the known alignment values', () => {
    expect(text({ textAlign: 'center' })!.textAlign).toBe('center');
    expect(text({ textAlign: 'justified' })!.textAlign).toBe('left');
    expect(text({ verticalAlign: 'bottom' })!.verticalAlign).toBe('bottom');
    expect(text({ verticalAlign: 'sideways' })!.verticalAlign).toBe('middle');
  });

  it('keeps a containerId so a bound text stays bound', () => {
    expect(text({ containerId: 'shape-1' })!.containerId).toBe('shape-1');
  });
});

describe('normalizeImportedElement — images', () => {
  it('keeps a safe src', () => {
    expect(imported({ type: 'image', src: 'https://cdn.example/a.png' })!.src).toBe(
      'https://cdn.example/a.png'
    );
  });

  it('accepts the legacy dataUrl spellings', () => {
    expect(imported({ type: 'image', dataUrl: 'https://cdn.example/a.png' })!.src).toBe(
      'https://cdn.example/a.png'
    );
    expect(imported({ type: 'image', dataURL: 'https://cdn.example/a.png' })!.src).toBe(
      'https://cdn.example/a.png'
    );
  });

  it('mirrors a data-URL src into dataUrl', () => {
    const out = imported({ type: 'image', src: 'data:image/png;base64,AAAA' });
    expect(out!.src).toBe('data:image/png;base64,AAAA');
    // Both spellings set, because the renderer and the uploader read different ones.
    expect(out!.dataUrl).toBe('data:image/png;base64,AAAA');
  });

  it('does not mirror a non-data src into dataUrl', () => {
    expect(imported({ type: 'image', src: 'https://cdn.example/a.png' })).not.toHaveProperty(
      'dataUrl'
    );
  });

  it('resolves the source from the file map when the element carries none', () => {
    const out = normalizeImportedElement(rect({ type: 'image', fileId: 'f1' }), {
      f1: { dataURL: 'https://cdn.example/stored.png' },
    });
    expect(out!.src).toBe('https://cdn.example/stored.png');
  });

  it('rejects an image whose file-map entry holds an unsafe source', () => {
    expect(
      normalizeImportedElement(rect({ type: 'image', fileId: 'f1' }), {
        f1: { dataURL: 'javascript:alert(1)' },
      })
    ).toBeNull();
  });
});

describe('normalizeImportedElement — embeds and frames', () => {
  it('keeps a safe embed url and its title', () => {
    const out = imported({ type: 'embed', url: 'https://example.com', title: 'Docs' });
    expect(out!.url).toBe('https://example.com');
    expect(out!.title).toBe('Docs');
  });

  it('accepts the legacy link field for the url', () => {
    expect(imported({ type: 'embed', link: 'https://example.com' })!.url).toBe(
      'https://example.com'
    );
  });

  it('names a frame from its name field', () => {
    expect(imported({ type: 'frame', name: 'Panel' })!.title).toBe('Panel');
    expect(imported({ type: 'frame' })).not.toHaveProperty('title');
  });
});

describe('remapElementReferences', () => {
  const ids = new Map([
    ['old-a', 'new-a'],
    ['old-b', 'new-b'],
  ]);

  const element = (over: Partial<DriplElement> = {}) =>
    ({
      id: 'e1',
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      ...over,
    }) as DriplElement;

  it('rewrites every id reference it knows', () => {
    const out = remapElementReferences(
      element({
        groupId: 'old-a',
        labelId: 'old-b',
        containerId: 'old-a',
        boundElementId: 'old-b',
      } as Partial<DriplElement>),
      ids
    );
    expect(out.groupId).toBe('new-a');
    expect(out.labelId).toBe('new-b');
    expect(out.containerId).toBe('new-a');
    expect(out.boundElementId).toBe('new-b');
  });

  it('rewrites binding endpoints and keeps the rest of the binding', () => {
    const out = remapElementReferences(
      element({
        startBinding: { elementId: 'old-a', mode: 'orbit', fixedPoint: { x: 1, y: 2 } },
        endBinding: { elementId: 'old-b' },
      } as unknown as Partial<DriplElement>),
      ids
    );
    expect(out.startBinding).toEqual({
      elementId: 'new-a',
      mode: 'orbit',
      fixedPoint: { x: 1, y: 2 },
    });
    expect(out.endBinding).toEqual({ elementId: 'new-b' });
  });

  it('rewrites every entry of boundElements', () => {
    const out = remapElementReferences(
      element({
        boundElements: [
          { id: 'old-a', type: 'arrow' },
          { id: 'old-b', type: 'text' },
        ],
      } as unknown as Partial<DriplElement>),
      ids
    );
    expect(out.boundElements).toEqual([
      { id: 'new-a', type: 'arrow' },
      { id: 'new-b', type: 'text' },
    ]);
  });

  it('leaves an unmapped id alone rather than dropping it', () => {
    const out = remapElementReferences(
      element({ groupId: 'unknown' } as Partial<DriplElement>),
      ids
    );
    expect(out.groupId).toBe('unknown');
  });

  it('does not mutate the element it was given', () => {
    const original = element({ groupId: 'old-a' } as Partial<DriplElement>);
    remapElementReferences(original, ids);
    expect(original.groupId).toBe('old-a');
  });

  it('leaves absent references absent', () => {
    const out = remapElementReferences(element(), ids);
    expect(out.groupId).toBeUndefined();
    expect(out).not.toHaveProperty('startBinding');
    expect(out).not.toHaveProperty('boundElements');
  });
});
