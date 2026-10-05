import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import * as AvatarPrimitive from '@radix-ui/react-avatar';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

/**
 * `components/ui/avatar.tsx` is three `forwardRef` wrappers over Radix's avatar
 * primitives. Radix owns the image-load state machine -- it decides whether the
 * image or the fallback shows, and when; nothing here asserts that.
 *
 * What this file contributes, and what is therefore asserted:
 *
 *   the three base class strings -- declared nowhere else, so a rename is
 *     invisible unless a test pins the class list;
 *   the `cn(base, className)` merge order -- caller last, so `twMerge` drops the
 *     base utility in favour of the caller's. Reversed, every override in the
 *     app is silently dropped while the component keeps rendering;
 *   ref forwarding and the `{...props}` spread -- how a caller measures the
 *     surface or attaches an id and an `alt`;
 *   `displayName` mirroring the Radix primitive. In
 *     `@radix-ui/react-avatar@1.2.6` the primitives do not define one, so both
 *     sides of that comparison are currently `undefined` and the assertion pins
 *     the *mirroring* rather than a literal -- it fails if the assignment is
 *     replaced with a hand-written name that drifts from the primitive.
 *
 * The base geometry is the load-bearing part: `h-10 w-10` on the root and
 * `h-full w-full` on both children are what make a 40px round avatar out of an
 * arbitrarily sized image. A merge test only proves a base value *loses*, which
 * holds for any value, so each base list gets its own assertion with no caller
 * class in play.
 *
 * Radix gates the image on a real load, and jsdom never loads an image, so
 * `HTMLImageElement.prototype` is stubbed to report a completed, non-zero-width
 * image. Without that, Radix holds the status at `loading`, renders no `<img>`
 * at all, and every `AvatarImage` assertion here would fail for a reason that
 * has nothing to do with this file. The fallback is the inverse case -- Radix
 * renders it only while the image is *not* loaded -- so the fallback tests use an
 * avatar with no `src` and leave the stub in place.
 */

/**
 * Make `new Image()` report `complete` with a non-zero `naturalWidth`, which is
 * exactly the pair `getImageLoadingStatus` reads to answer `'loaded'`.
 */
function stubLoadedImages() {
  Object.defineProperty(HTMLImageElement.prototype, 'complete', {
    configurable: true,
    get: () => true,
  });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
    configurable: true,
    get: () => 100,
  });
}

function restoreImageStubs() {
  // `delete` rather than `defineProperty(..., undefined)`: jsdom defines both on
  // the prototype itself, so removing our override must hand back *its* getter
  // rather than leave a property that answers `undefined` for every image.
  delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).complete;
  delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).naturalWidth;
}

afterEach(() => {
  cleanup();
  restoreImageStubs();
});

/** An avatar whose image Radix considers loaded. */
function renderAvatar(
  rootProps: React.ComponentProps<typeof Avatar> = {},
  imageProps: React.ComponentProps<typeof AvatarImage> = {}
) {
  stubLoadedImages();
  return render(
    <Avatar data-testid="root" {...rootProps}>
      <AvatarImage src="/avatar.png" alt="Ada" data-testid="image" {...imageProps} />
      <AvatarFallback data-testid="fallback">AD</AvatarFallback>
    </Avatar>
  );
}

/**
 * An avatar with no image at all, so Radix holds the fallback.
 *
 * `useImageLoadingStatus` sets the status to `'error'` when `src` is absent, and
 * `AvatarFallback` renders exactly when the status is not `'loaded'` -- so a
 * missing `src` is the reliable way to reach the fallback branch.
 */
function renderAvatarWithoutImage(
  rootProps: React.ComponentProps<typeof Avatar> = {},
  fallbackProps: React.ComponentProps<typeof AvatarFallback> = {}
) {
  return render(
    <Avatar data-testid="root" {...rootProps}>
      <AvatarFallback data-testid="fallback" {...fallbackProps}>
        AD
      </AvatarFallback>
    </Avatar>
  );
}

describe('Avatar', () => {
  // Regression: the root's geometry and shape. `shrink-0` is what stops an
  // avatar being squeezed flat inside a flex row, and `overflow-hidden` is what
  // clips the image to the circle.
  it('declares its base size, shape and clipping when no className is given', () => {
    renderAvatar();

    const root = screen.getByTestId('root');
    expect(root).toHaveClass(
      'relative',
      'flex',
      'h-10',
      'w-10',
      'shrink-0',
      'overflow-hidden',
      'rounded-full'
    );
  });

  // Regression: `cn(base, className)` puts the caller last. Reversed, the base
  // `h-10 w-10 rounded-full` would beat an explicit caller size and every sized
  // avatar in the app would stay 40px.
  it('resolves conflicting size and shape classes in the caller favour', () => {
    renderAvatar({ className: 'h-16 w-16 rounded-md' });

    const root = screen.getByTestId('root');
    expect(root).toHaveClass('h-16', 'w-16', 'rounded-md');
    expect(root.className).not.toContain('h-10');
    expect(root.className).not.toContain('w-10');
    expect(root.className).not.toContain('rounded-full');
    // Non-conflicting base utilities survive the merge.
    expect(root).toHaveClass('relative', 'flex', 'shrink-0', 'overflow-hidden');
  });

  it('appends the caller classes after the base ones', () => {
    renderAvatar({ className: 'ring-2' });

    const root = screen.getByTestId('root');
    expect(root.className.indexOf('ring-2')).toBeGreaterThan(root.className.indexOf('relative'));
  });

  // Regression: `ref={ref}` plus the `{...props}` spread. Dropping either leaves
  // an element that cannot be measured and cannot carry an id.
  it('forwards its ref and extra props to the root element', () => {
    const nodes: HTMLSpanElement[] = [];

    renderAvatar({
      id: 'collaborator-avatar',
      ref: node => {
        if (node) nodes.push(node);
      },
    });

    const root = screen.getByTestId('root');
    expect(root).toHaveAttribute('id', 'collaborator-avatar');
    expect(nodes).toEqual([root]);
    // The ref reaches the DOM node Radix rendered, not an intermediate element.
    expect(nodes[0]).toBeInstanceOf(HTMLElement);
  });

  it('takes its displayName from the Radix primitive', () => {
    expect(Avatar.displayName).toBe(AvatarPrimitive.Root.displayName);
  });
});

describe('AvatarImage', () => {
  // Regression: the image fills whatever box the root declares. `aspect-square`
  // plus `h-full w-full` is what keeps a non-square source image from being
  // letterboxed inside the circle.
  it('declares its base fill geometry when no className is given', () => {
    renderAvatar();

    expect(screen.getByTestId('image')).toHaveClass('aspect-square', 'h-full', 'w-full');
  });

  it('resolves conflicting size classes in the caller favour', () => {
    renderAvatar({}, { className: 'h-8 w-8' });

    const image = screen.getByTestId('image');
    expect(image).toHaveClass('h-8', 'w-8');
    expect(image.className).not.toContain('h-full');
    expect(image.className).not.toContain('w-full');
    // `aspect-square` does not conflict with a size, so it survives.
    expect(image).toHaveClass('aspect-square');
  });

  // Regression: the ref plus the spread, and `alt` in particular -- Radix's Image
  // is the element that carries the accessible name of the whole avatar, and
  // `src` is the prop Radix consumes to decide whether to render at all.
  it('forwards its ref and extra props to the image', () => {
    const nodes: HTMLImageElement[] = [];

    renderAvatar(
      {},
      {
        alt: 'Grace Hopper',
        id: 'avatar-img',
        ref: (node: HTMLImageElement | null) => {
          if (node) nodes.push(node);
        },
      }
    );

    const image = screen.getByTestId('image');
    expect(image.tagName).toBe('IMG');
    expect(image).toHaveAttribute('id', 'avatar-img');
    expect(image).toHaveAttribute('alt', 'Grace Hopper');
    expect(nodes).toEqual([image]);
  });

  it('takes its displayName from the Radix primitive', () => {
    expect(AvatarImage.displayName).toBe(AvatarPrimitive.Image.displayName);
  });
});

describe('AvatarFallback', () => {
  // Regression: the fallback is the initial-letter tile. Its `bg-muted` and
  // centring are the only reason a user with no avatar picture sees a circle
  // rather than a transparent hole.
  it('declares its base fill, centring and colour when no className is given', () => {
    renderAvatarWithoutImage();

    expect(screen.getByTestId('fallback')).toHaveClass(
      'flex',
      'h-full',
      'w-full',
      'items-center',
      'justify-center',
      'rounded-full',
      'bg-muted'
    );
  });

  it('resolves conflicting colour and size classes in the caller favour', () => {
    renderAvatarWithoutImage({}, { className: 'bg-red-500 h-6 w-6' });

    const fallback = screen.getByTestId('fallback');
    expect(fallback).toHaveClass('bg-red-500', 'h-6', 'w-6');
    expect(fallback.className).not.toContain('bg-muted');
    expect(fallback.className).not.toContain('h-full');
    expect(fallback.className).not.toContain('w-full');
    // Centring is not a conflicting axis, so it survives.
    expect(fallback).toHaveClass('items-center', 'justify-center', 'rounded-full');
  });

  it('forwards its ref and extra props, and renders its children', () => {
    const nodes: HTMLSpanElement[] = [];

    renderAvatarWithoutImage(
      {},
      {
        id: 'avatar-fallback',
        ref: (node: HTMLSpanElement | null) => {
          if (node) nodes.push(node);
        },
      }
    );

    const fallback = screen.getByTestId('fallback');
    expect(fallback).toHaveAttribute('id', 'avatar-fallback');
    expect(fallback).toHaveTextContent('AD');
    expect(nodes).toEqual([fallback]);
  });

  it('takes its displayName from the Radix primitive', () => {
    expect(AvatarFallback.displayName).toBe(AvatarPrimitive.Fallback.displayName);
  });
});

describe('Avatar composition', () => {
  // Regression: the image and the fallback must land *inside* the root's clipping
  // box, which is what the root's `overflow-hidden rounded-full` clips. Asserting
  // the containment pins the relationship; which of the two is visible is Radix's
  // decision and is not asserted here.
  it('nests the image inside the clipped root', () => {
    renderAvatar();

    const root = screen.getByTestId('root');
    expect(root).toContainElement(screen.getByTestId('image'));
    expect(root).toHaveClass('overflow-hidden', 'rounded-full');
  });

  // The fallback is a child of the same clipped root, so a caller's `bg-muted`
  // circle is clipped the same way an image is. This is the relationship the
  // `h-full w-full` on the fallback exists to satisfy.
  it('nests the fallback inside the clipped root', () => {
    renderAvatarWithoutImage();

    const root = screen.getByTestId('root');
    expect(root).toContainElement(screen.getByTestId('fallback'));
    expect(screen.getByTestId('fallback')).toHaveClass('h-full', 'w-full');
  });
});
