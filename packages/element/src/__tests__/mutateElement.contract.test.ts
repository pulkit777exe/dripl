import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import type { DriplElement, LinearElement } from '@dripl/common';

import { mutateElement, type ElementUpdate } from '../mutateElement';
import {
  hasCachedBitmapForTest,
  renderStaticScene,
  resetElementBitmapCacheForTest,
  seedCacheEntryForTest,
  type StaticSceneFrameStats,
} from '../staticScene';
import { getShapeFromCache, setShapeInCache } from '../shape-cache';

/** A linear element, because it is the widest element union member. */
function arrow(overrides: Partial<LinearElement> = {}): LinearElement {
  return {
    id: 'arrow-1',
    type: 'arrow',
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ],
    version: 3,
    versionNonce: 17,
    ...overrides,
  } as LinearElement;
}

/**
 * A freedraw element — the one type whose rotation is baked into its bitmap
 * rather than applied when the bitmap is blitted.
 */
function freedraw(overrides: Partial<DriplElement> = {}): DriplElement {
  return {
    id: 'freedraw-1',
    type: 'freedraw',
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    points: [
      { x: 0, y: 0 },
      { x: 50, y: 25 },
      { x: 100, y: 50 },
    ],
    version: 1,
    versionNonce: 5,
    ...overrides,
  } as DriplElement;
}

/**
 * A canvas stand-in with a no-op context. jsdom cannot allocate a real 2D
 * context, so this exercises the *cache* half of the render path — which is
 * what the carry-forward changes — without pretending to rasterize anything.
 */
function sceneCanvas(): HTMLCanvasElement {
  const ctx = {
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
    save: () => undefined,
    restore: () => undefined,
    setTransform: () => undefined,
    clearRect: () => undefined,
    scale: () => undefined,
    translate: () => undefined,
    rotate: () => undefined,
    drawImage: () => undefined,
    fillRect: () => undefined,
    strokeRect: () => undefined,
    setLineDash: () => undefined,
    fillText: () => undefined,
    strokeText: () => undefined,
    beginPath: () => undefined,
    closePath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    stroke: () => undefined,
    fill: () => undefined,
    measureText: () => ({ width: 0 }),
  };
  return {
    getContext: () => ctx,
    width: 800,
    height: 600,
    style: {},
  } as unknown as HTMLCanvasElement;
}

const MAX_NONCE = 2_147_483_647;

afterEach(() => {
  vi.restoreAllMocks();
  resetElementBitmapCacheForTest();
});

describe('mutateElement version contract', () => {
  it('increments version by exactly one for every mutated field', () => {
    // Every field the interface declares, so a new field cannot be added
    // without this noticing that it bypasses the bump.
    const updates: ElementUpdate[] = [
      { x: 7 },
      { y: 7 },
      { width: 7 },
      { height: 7 },
      { angle: 0.5 },
      { opacity: 0.5 },
      { strokeColor: '#fff' },
      { backgroundColor: '#000' },
      { strokeWidth: 9 },
      { roughness: 2 },
      { strokeStyle: 'dashed' },
      { fillStyle: 'solid' },
      { groupId: 'g1' },
      { fractionalIndex: 'a1' },
      { text: 'hi' },
      { fontSize: 11 },
      { fontFamily: 'Inter' },
      { points: [{ x: 1, y: 1 }] },
      { src: 'https://example.test/a.png' },
    ];

    for (const update of updates) {
      const updated = mutateElement(arrow(), update);
      expect(updated.version).toBe(4);
    }
  });

  it('increments version by exactly one for any starting version', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2_000_000_000 }), version => {
        const updated = mutateElement(arrow({ version }), { x: 1 });
        expect(updated.version).toBe(version + 1);
      })
    );
  });

  it('treats a missing version as 0 and lands on 1', () => {
    const legacy = { ...arrow(), version: undefined } as unknown as DriplElement;
    expect(mutateElement(legacy, { x: 5 }).version).toBe(1);
  });

  it('redraws the versionNonce on every real mutation', () => {
    // The nonce is a tie-break between replicas, so it has to move whenever the
    // payload moves. A frozen nonce would make every same-version pair a tie.
    const nonces = new Set<number>();
    let current = arrow();
    for (let i = 0; i < 50; i += 1) {
      current = mutateElement(current, { x: i });
      nonces.add(current.versionNonce as number);
    }
    expect(nonces.size).toBeGreaterThan(40);
  });

  it('keeps versionNonce a non-negative integer inside the 31-bit range', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5000 }), index => {
        const updated = mutateElement(arrow(), { x: index });
        expect(Number.isInteger(updated.versionNonce)).toBe(true);
        expect(updated.versionNonce).toBeGreaterThanOrEqual(0);
        // `Math.floor(random() * MAX)` can produce at most MAX - 1.
        expect(updated.versionNonce).toBeLessThan(MAX_NONCE);
      })
    );
  });

  it('honours a zero versionNonce as a real value rather than "missing"', () => {
    // `compareElementFreshness` reads the nonce as `?? 0`, so a minted 0 is
    // indistinguishable from an absent nonce. It is a legitimate draw and must
    // be stored as-is rather than substituted.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const updated = mutateElement(arrow(), { x: 3 });
    expect(updated.versionNonce).toBe(0);
    expect('versionNonce' in updated).toBe(true);
  });

  it('advances the version by one per effective edit and not at all per no-op', () => {
    // One lineage's keys are unique by version alone; the nonce only breaks
    // ties across replicas. So the version must advance on every commit and
    // hold still on a rejected no-op — neither more nor less than once.
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -3, max: 3 }), { minLength: 1, maxLength: 40 }),
        xs => {
          let current = arrow();
          for (const x of xs) {
            const isNoOp = x === current.x;
            const next = mutateElement(current, { x });
            expect(next.version).toBe((current.version ?? 0) + (isNoOp ? 0 : 1));
            current = next;
          }
        }
      )
    );
  });
});

describe('mutateElement no-op guard', () => {
  it('returns the same reference when no field differs', () => {
    const original = arrow();
    expect(mutateElement(original, { x: 0, y: 0, width: 100, height: 50 })).toBe(original);
  });

  it('treats an empty update as a no-op', () => {
    const original = arrow();
    expect(mutateElement(original, {})).toBe(original);
  });

  it('ignores undefined values rather than clearing the field', () => {
    // `undefined` must not be read as "set this field to undefined": it is the
    // documented way to express "not part of this update".
    const original = arrow();
    // `ElementUpdate` declares those keys as `x?: number`, and with
    // `exactOptionalPropertyTypes` an explicit `undefined` needs its own cast.
    const noFields = { x: undefined, strokeColor: undefined } as unknown as ElementUpdate;
    const updated = mutateElement(original, noFields);
    expect(updated).toBe(original);
    expect(updated.x).toBe(0);
    expect(updated.strokeColor).toBeUndefined();
  });

  it('commits when only one of several fields changes', () => {
    const updated = mutateElement(arrow(), { x: 0, y: 0, width: 250 });
    expect(updated).not.toBe(arrow());
    expect(updated.width).toBe(250);
  });

  it('does not invalidate the caches for a no-op', () => {
    // A no-op must be free. The previous frame's bitmap and drawable are still
    // correct, and dropping them would cost a full regeneration for nothing.
    const element = arrow();
    seedCacheEntryForTest(element);
    setShapeInCache(element, { shape: 'drawable' } as never, 'light');

    expect(mutateElement(element, { x: 0 })).toBe(element);

    expect(hasCachedBitmapForTest(element)).toBe(true);
    expect(getShapeFromCache(element, 'light')).toEqual({ shape: 'drawable' });
  });

  it('compares point arrays by value, not by identity', () => {
    const original = arrow();
    const equalCopy = mutateElement(original, {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 50 },
      ],
    });
    expect(equalCopy).toBe(original);

    const movedY = mutateElement(original, {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 51 },
      ],
    });
    expect(movedY).not.toBe(original);

    const shorter = mutateElement(original, { points: [{ x: 0, y: 0 }] });
    expect(shorter).not.toBe(original);
  });
});

describe('mutateElement cache invalidation', () => {
  it('drops both the bitmap and the drawable on a size change', () => {
    // `width` is a pixel-affecting key: the bitmap is rasterized at the
    // element's size, so a carry here would freeze the old bounds. The
    // position-only counterpart is asserted in 'mutateElement cache
    // carry-forward' below — note that both blocks assert on the *successor*
    // object, since a cache that merely leaves the old one is not evidence of
    // anything: it would leave even if the entry had been carried across.
    const element = arrow();
    seedCacheEntryForTest(element);
    setShapeInCache(element, { shape: 'drawable' } as never, 'light');

    const resized = mutateElement(element, { width: 42 });

    expect(hasCachedBitmapForTest(element)).toBe(false);
    expect(hasCachedBitmapForTest(resized)).toBe(false);
    expect(getShapeFromCache(resized, 'light')).toBeUndefined();
  });

  it('drops both caches for an appearance-only change too', () => {
    // This is the load-bearing claim in the source comment: the bitmap embeds
    // stroke colour and geometry, so a geometry-only invalidation check would
    // leave a stale image on screen. `opacity` is absent from this list on
    // purpose — it is compositing, applied when the bitmap is placed, and
    // generation bakes nothing; see the carry test below.
    for (const appearance of [{ strokeColor: '#ff0000' }, { strokeWidth: 7 }]) {
      const element = arrow();
      seedCacheEntryForTest(element);
      setShapeInCache(element, { shape: 'drawable' } as never, 'light');

      const restyled = mutateElement(element, appearance);

      expect(hasCachedBitmapForTest(element)).toBe(false);
      expect(hasCachedBitmapForTest(restyled)).toBe(false);
      expect(getShapeFromCache(restyled, 'light')).toBeUndefined();
    }
  });

  it('carries both caches for an opacity change', () => {
    // Opacity is applied when the finished bitmap is placed (`drawElement` at
    // blit, `renderDraftElement` for a direct draw); generation no longer
    // multiplies it into the pixels, so the cached pixels stay valid. It used
    // to be baked as `globalAlpha` and then applied again at blit — a stored
    // opacity of 0.5 rendered as 0.25.
    const element = arrow({ opacity: 1 });
    seedCacheEntryForTest(element);
    setShapeInCache(element, { shape: 'drawable' } as never, 'light');

    const faded = mutateElement(element, { opacity: 0.5 });

    expect(hasCachedBitmapForTest(faded)).toBe(true);
    expect(getShapeFromCache(faded, 'light')).toEqual({ shape: 'drawable' });
  });

  it('invalidates the bitmap keyed by id even when the id map holds another object', () => {
    // `invalidateElementCache` is string-keyed while the bitmap cache is keyed
    // by object identity, so the lookup has to go through the id map. Seeding
    // two objects under one id proves which side of that bridge is consulted.
    // The mutation has to be one that invalidates: a position-only change now
    // *carries* the entry to the successor, which would make this pass for a
    // reason that has nothing to do with the id bridge.
    const original = arrow({ id: 'shared' });
    seedCacheEntryForTest(original);
    expect(hasCachedBitmapForTest(original)).toBe(true);

    const replacement = mutateElement(original, { width: 1 });
    expect(replacement.id).toBe('shared');
    expect(hasCachedBitmapForTest(original)).toBe(false);
    // The mutated object is a different reference, and the change reached the
    // pixels, so it never had a bitmap.
    expect(hasCachedBitmapForTest(replacement)).toBe(false);
  });
});

describe('mutateElement cache carry-forward', () => {
  it('moves both caches to the successor on a position-only change', () => {
    // A drag must not rebuild anything: the bitmap is generated in the
    // element's local frame and re-positioned at blit time, so the pixels are
    // identical wherever the element sits. Both caches therefore follow the
    // new object rather than dying with the old one.
    for (const position of [{ x: 42 }, { y: 7 }, { fractionalIndex: 'a3' }]) {
      const element = arrow();
      seedCacheEntryForTest(element);
      setShapeInCache(element, { shape: 'drawable' } as never, 'light');

      const moved = mutateElement(element, position);

      expect(moved).not.toBe(element);
      // Left the object it was cached under...
      expect(hasCachedBitmapForTest(element)).toBe(false);
      expect(getShapeFromCache(element, 'light')).toBeUndefined();
      // ...and arrived on the successor, so the next frame can hit it.
      expect(hasCachedBitmapForTest(moved)).toBe(true);
      expect(getShapeFromCache(moved, 'light')).toEqual({ shape: 'drawable' });
    }
  });

  it('is a cache hit on the next frame, not merely still present', () => {
    // Presence alone would prove nothing: `getOrCreateElementCanvas` compares
    // the entry's recorded version against the element's, so a carry that
    // forgot to refresh it would leave an entry that exists and is missed
    // every single frame — the same waste with better optics instead of the
    // fix.
    const element = arrow({ x: 10, y: 10 });
    seedCacheEntryForTest(element);

    const moved = mutateElement(element, { x: 60 });
    // A holder rather than a `let`: the frame arrives through a callback that
    // TypeScript cannot see running, so a local would narrow to `null` and then
    // to `never` at the assertions.
    const seen: { frame: StaticSceneFrameStats | null } = { frame: null };
    renderStaticScene(
      sceneCanvas(),
      [moved],
      { x: 0, y: 0, width: 800, height: 600, zoom: 1 },
      {
        gridEnabled: false,
        gridSize: 20,
        zoom: 1,
        theme: 'light',
        dpr: 1,
        elements: [moved],
        visibleElements: [moved],
        onFrameStats: frame => {
          seen.frame = frame;
        },
      }
    );

    expect(seen.frame?.bitmapsReused).toBe(1);
    expect(seen.frame?.bitmapsGenerated).toBe(0);
  });

  it('carries angle for types rotated when blitted', () => {
    // Every type but freedraw is rotated by `drawElement` at blit time, so the
    // angle never reaches the stored pixels.
    const element = arrow();
    seedCacheEntryForTest(element);
    setShapeInCache(element, { shape: 'drawable' } as never, 'light');

    const rotated = mutateElement(element, { angle: Math.PI / 4 });

    expect(hasCachedBitmapForTest(rotated)).toBe(true);
    expect(getShapeFromCache(rotated, 'light')).toEqual({ shape: 'drawable' });
  });

  it('carries both caches for a freedraw rotation', () => {
    // Rotation is compositing: `renderRoughElement` generates the outline
    // unrotated and `drawElement` rotates the bitmap at blit, exactly like
    // every other type — so a freedraw angle is pixel-invisible to the cache.
    // It used to be baked while generating, which made a rotated stroke turn
    // by 2θ on the cached path.
    const element = freedraw();
    seedCacheEntryForTest(element);
    setShapeInCache(element, { shape: 'drawable' } as never, 'light');

    const rotated = mutateElement(element, { angle: Math.PI / 4 });

    expect(hasCachedBitmapForTest(rotated)).toBe(true);
    expect(getShapeFromCache(rotated, 'light')).toEqual({ shape: 'drawable' });
  });

  it('drops both caches when a move arrives with a content change', () => {
    // One content key among position keys still makes the render stale, so the
    // decision is taken over *every* key that actually changed, not the first.
    const element = arrow();
    seedCacheEntryForTest(element);
    setShapeInCache(element, { shape: 'drawable' } as never, 'light');

    const resized = mutateElement(element, { x: 42, width: 250 });

    expect(hasCachedBitmapForTest(resized)).toBe(false);
    expect(getShapeFromCache(resized, 'light')).toBeUndefined();
  });

  it('refuses to carry a bitmap that embeds another element', () => {
    // An arrow's label is cut out of the arrow's own bitmap. Whether that label
    // moved with the arrow is a question about label layout, not about this
    // element, so such an owner drops its entry exactly as any other content
    // change would — and the version check on lookup keeps guarding it
    // afterwards, because a label edited later bumps its version regardless.
    const element = arrow({ labelId: 'label-1' } as Partial<LinearElement>);
    seedCacheEntryForTest(element, 120, 90, new Map([['label-1', 3]]));

    const moved = mutateElement(element, { x: 42 });

    expect(hasCachedBitmapForTest(element)).toBe(false);
    expect(hasCachedBitmapForTest(moved)).toBe(false);
  });
});
