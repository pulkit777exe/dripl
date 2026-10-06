import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The reduced-motion block in `app/globals.css` lists animated classes **by name** rather
 * than applying a blanket `* { transition: none }`. That is the right call — a blanket rule
 * would also cancel transitions the app does not own — but it means a new animated class
 * silently animates for users who asked it not to unless somebody remembers to add it.
 *
 * These tests fail when that happens, which is the only moment it matters. Writing them
 * found `.t-error-msg` missing from the block.
 */
const css = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8');

/**
 * The reduced-motion block, with comments removed.
 *
 * Stripping comments matters: an explanatory comment that names a class satisfies a naive
 * `includes`, which is exactly how the first version of this file passed while
 * `.t-error-msg` was still absent from the block.
 */
const reducedMotionBlock = (() => {
  const start = css.indexOf('@media (prefers-reduced-motion');
  if (start === -1) throw new Error('globals.css has no prefers-reduced-motion block');
  // The block closes at the first `}` at column 0 after the opening line.
  const end = css.indexOf('\n}', start);
  return css.slice(start, end === -1 ? css.length : end).replace(/\/\*[\s\S]*?\*\//g, '');
})();

/**
 * Every `t-*` class that is itself the element carrying a transition or an animation.
 *
 * Two things this has to get right, both found by the first version failing:
 *
 * - Only the **last compound** of the selector counts. `.t-input-wrap.is-error
 *   .t-error-msg` transitions the message, not the wrapper, and requiring `.t-input-wrap`
 *   in the block would be wrong — the wrapper has no motion to cancel.
 * - `transition-property:` counts. `.t-theme` sets only that, and a regex looking for
 *   `transition:` alone would silently exclude the class this file was written for.
 *
 * Ancestors are still *reachable* through coverage: the block contains
 * `.t-icon-swap .t-icon`, and `isCovered` matches on a substring, so `.t-icon` is covered by
 * a rule that also names its ancestor.
 */
function animatedTransitionClasses(): string[] {
  const names = new Set<string>();
  for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selector = match[1] ?? '';
    const body = match[2] ?? '';
    if (!/\b(transition|animation)(-property)?\s*:/.test(body)) continue;
    if (selector.includes('@')) continue;
    for (const part of selector.split(',')) {
      const compounds = part.trim().split(/\s+/).filter(Boolean);
      const target = compounds[compounds.length - 1] ?? '';
      for (const nameMatch of target.matchAll(/\.(t-[a-z-]+)/g)) {
        const name = nameMatch[1];
        if (name) names.add(name);
      }
    }
  }
  return [...names].sort();
}

/** Whether the block targets this class, directly or as part of a descendant selector. */
function isCovered(name: string): boolean {
  return new RegExp(`\\.${name}\\b`).test(reducedMotionBlock);
}

describe('reduced-motion coverage', () => {
  it('finds the animated transition classes it expects to exist', () => {
    // Guards the guard: if this ever returns empty, every assertion below passes vacuously.
    const animated = animatedTransitionClasses();
    expect(animated.length).toBeGreaterThan(3);
    expect(animated).toContain('t-theme');
    expect(animated).toContain('t-icon');
  });

  it('disables every animated t-* class', () => {
    const missing = animatedTransitionClasses().filter(name => !isCovered(name));
    expect(missing).toEqual([]);
  });

  it('disables motion rather than hiding the final state', () => {
    // `display: none` or `visibility: hidden` would remove the feedback entirely; the
    // block must only cancel motion so the new colour or width still appears.
    expect(reducedMotionBlock).toContain('transition: none !important');
    expect(reducedMotionBlock).not.toMatch(/display:\s*none/);
    expect(reducedMotionBlock).not.toMatch(/visibility:\s*hidden/);
  });

  // The entries use the `transition: none` / `animation: none` shorthand rather than a bare
  // `transition-property: none`. The shorthand resets duration, timing and delay together;
  // setting only the property would leave a duration in place, which does nothing on its
  // own but invites a later `transition-duration` utility to reintroduce motion unnoticed.
  // `.t-success-check` is a keyframe animation, so `animation: none` is its correct reset.
  //
  // The block also uses `transition-duration: 0.01ms !important` for the canvas
  // affordances, deliberately rather than inconsistently: a 0.01ms transition still fires
  // `transitionend`, while `transition: none` never will. Anything awaiting that event needs
  // the former. So this asserts the `t-*` entries specifically.
  it('resets t-* entries with a shorthand, not a bare property', () => {
    const tEntries = [...reducedMotionBlock.matchAll(/\.(t-[a-z-]+)[^{}]*\{([^}]*)\}/g)];
    expect(tEntries.length).toBeGreaterThan(0);

    for (const entry of tEntries) {
      const body = entry[2] ?? '';
      expect(body).toMatch(/(transition|animation): none !important/);
      expect(body).not.toContain('transition-property: none');
    }
  });
});
