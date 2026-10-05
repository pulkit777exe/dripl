import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * `components/ui/button.tsx` is a `class-variance-authority` recipe plus one
 * `forwardRef` wrapper whose only branch is `asChild`.
 *
 * Two mechanics shape every assertion here, and both are easy to get wrong in a
 * test:
 *
 *   `cva` *concatenates*; it does not merge. `buttonVariants({ variant, size,
 *     className })` returns the base string with the selected variant's and
 *     size's classes appended, so a caller's conflicting class is present in that
 *     output *alongside* the base one. The conflict is resolved later, by the
 *     wrapper's `cn(...)`. So the recipe is asserted for *selection* (this
 *     variant's classes present, the other variants' absent) and the merge is
 *     asserted on the rendered element, where `cn` has actually run.
 *   Class comparison has to be by token, not by substring. `bg-primary` is a
 *     substring of `bg-primary-foreground` and of `hover:bg-primary/90`, so a
 *     `not.toContain('bg-primary')` on a class *list* fails for a button that is
 *     behaving exactly as intended. `tokens()` is that fix, and every assertion
 *     below goes through it.
 *
 * `asChild` is the other real decision: it swaps the rendered element for `Slot`,
 * so a caller can style a `Link` or an `a` as a button without nesting a
 * `<button>` inside an anchor. Both directions are asserted -- the child element
 * is what ends up in the tree carrying the button's classes, and no button role
 * exists at all.
 */

afterEach(() => {
  cleanup();
});

type ButtonProps = React.ComponentProps<typeof Button>;
type Variant = NonNullable<ButtonProps['variant']>;
type Size = NonNullable<ButtonProps['size']>;

/** A class list as a set of tokens, so comparisons are per class and not textual. */
function tokens(classList: string): string[] {
  return [...new Set(classList.split(/\s+/).filter(Boolean))];
}

/**
 * Classes that identify one variant and no other.
 *
 * `shadow` / `shadow-sm` are deliberately excluded from these lists: several
 * variants share them on purpose, so holding them apart would be asserting a
 * distinction the recipe does not make.
 */
const VARIANT_MARKERS: Record<Variant, string[]> = {
  default: ['bg-primary', 'text-primary-foreground', 'hover:bg-primary/90'],
  destructive: ['bg-destructive', 'text-destructive-foreground', 'hover:bg-destructive/90'],
  outline: ['border-input', 'bg-background', 'hover:bg-accent', 'hover:text-accent-foreground'],
  secondary: ['bg-secondary', 'text-secondary-foreground', 'hover:bg-secondary/80'],
  ghost: ['hover:bg-accent', 'hover:text-accent-foreground'],
  link: ['text-primary', 'underline-offset-4', 'hover:underline'],
};

const VARIANT_NAMES = Object.keys(VARIANT_MARKERS) as Variant[];

const SIZE_MARKERS: Record<Size, string[]> = {
  default: ['h-9', 'px-4', 'py-2'],
  sm: ['h-8', 'px-3', 'text-xs'],
  lg: ['h-10', 'px-8'],
  icon: ['h-9', 'w-9'],
};

const SIZE_NAMES = Object.keys(SIZE_MARKERS) as Size[];

/**
 * The base recipe's classes, split into the parts no variant or size may take
 * away.
 *
 * Each is declared unconditionally, so its presence in the output proves the base
 * survived composition at all -- which is the failure a variant-specific
 * assertion alone would miss.
 */
const BASE_CLASSES = [
  'inline-flex',
  'items-center',
  'justify-center',
  'gap-2',
  'whitespace-nowrap',
  'rounded-md',
  'text-sm',
  'font-medium',
  'transition-colors',
  'focus-visible:outline-none',
  'focus-visible:ring-1',
  'focus-visible:ring-ring',
  'disabled:pointer-events-none',
  'disabled:opacity-50',
  '[&_svg]:pointer-events-none',
  '[&_svg]:size-4',
  '[&_svg]:shrink-0',
];

/** The recipe as the wrapper composes it: the recipe, then `cn`. */
function composed(props: ButtonProps) {
  return cn(
    buttonVariants({ variant: props.variant, size: props.size, className: props.className })
  );
}

describe('buttonVariants', () => {
  // Regression: the base string, asserted with nothing selected. It carries the
  // parts a button cannot work without -- the flex centring, the `disabled:*`
  // pair that makes a disabled button visibly inert and unclickable, and the
  // focus ring, which for a keyboard user is the only thing that is visible.
  it('declares the base recipe when nothing is selected', () => {
    const out = tokens(buttonVariants());

    for (const cls of BASE_CLASSES) {
      expect(out).toContain(cls);
    }
    // The default pair, because `defaultVariants` fills both in.
    expect(out).toEqual(
      expect.arrayContaining([...VARIANT_MARKERS.default, ...SIZE_MARKERS.default])
    );
  });

  // Regression: `defaultVariants`. Both defaults are `default`, and they are what
  // a caller gets from `<Button>` with no props -- so if either drifted, every
  // unconfigured button in the app would change size or colour and nothing else
  // would fail.
  it('falls back to the default variant and size', () => {
    expect(buttonVariants()).toBe(buttonVariants({ variant: 'default', size: 'default' }));
  });

  // Regression: the variants are mutually exclusive. `cva` concatenates, so a
  // recipe that leaked one variant's colour into another's would produce a class
  // list in which the browser silently picks a winner. Checking presence alone
  // would not catch that; the absence of the *other* variants' markers does.
  it.each(VARIANT_NAMES)('selects %s and no other variant', variant => {
    const out = tokens(buttonVariants({ variant }));

    for (const marker of VARIANT_MARKERS[variant]) {
      expect(out).toContain(marker);
    }
    for (const other of VARIANT_NAMES) {
      if (other === variant) continue;
      for (const marker of VARIANT_MARKERS[other]) {
        // Markers this variant shares with the other are not a leak.
        if (VARIANT_MARKERS[variant].includes(marker)) continue;
        expect(out).not.toContain(marker);
      }
    }
    // The base survives every variant.
    for (const cls of BASE_CLASSES) {
      expect(out).toContain(cls);
    }
  });

  // Regression: the sizes are mutually exclusive too, and `icon` is the one that
  // most easily goes wrong: a square with no padding, so a size that leaked
  // `px-4` into it would render a 36x36 button with 16px of horizontal padding
  // and no room for the glyph.
  it.each(SIZE_NAMES)('selects %s and no other size', size => {
    const out = tokens(buttonVariants({ size }));

    for (const marker of SIZE_MARKERS[size]) {
      expect(out).toContain(marker);
    }
    for (const other of SIZE_NAMES) {
      if (other === size) continue;
      for (const marker of SIZE_MARKERS[other]) {
        // `h-9` is shared by `default` and `icon` deliberately.
        if (SIZE_MARKERS[size].includes(marker)) continue;
        expect(out).not.toContain(marker);
      }
    }
  });

  // Regression: a caller class reaches the recipe, and it is *appended* -- the
  // recipe does not resolve the conflict, the wrapper's `cn` does. Asserting the
  // append here rather than the merge is what keeps the two responsibilities
  // pinned to the function that actually has them.
  it('appends a caller class without resolving the conflict itself', () => {
    const out = tokens(buttonVariants({ className: 'h-12' }));

    expect(out).toContain('h-12');
    // `h-9` is still there: `cva` concatenated, it did not merge.
    expect(out).toContain('h-9');
    // And `cn` is what collapses them, caller last.
    expect(tokens(composed({ className: 'h-12' }))).toContain('h-12');
    expect(tokens(composed({ className: 'h-12' }))).not.toContain('h-9');
  });
});

describe('Button', () => {
  // Regression: `displayName` is hand-written here rather than mirrored from a
  // primitive -- `Button` wraps a plain `'button'` string or `Slot`, so there is
  // nothing to copy from. Asserted as a literal for that reason.
  it('is named for React devtools', () => {
    expect(Button.displayName).toBe('Button');
  });

  // Regression: the default branch renders a real `<button>`, so the element is
  // reachable as a button in the accessibility tree and carries the platform's
  // own semantics.
  it('renders a real button with the default recipe by default', () => {
    render(<Button data-testid="btn">Save</Button>);

    const button = screen.getByTestId('btn');
    expect(button.tagName).toBe('BUTTON');
    expect(tokens(button.className)).toEqual(tokens(composed({})));
    expect(button).toHaveTextContent('Save');
  });

  // Regression: the `asChild` branch. The caller's element replaces the button and
  // inherits the classes, which is the whole point -- a router `Link` that looks
  // like a button, without an anchor inside a button (invalid HTML, and a focus
  // and keyboard trap in practice).
  it('renders the child element instead of a button when asChild is set', () => {
    render(
      <Button asChild data-testid="link">
        <a href="/dashboard">Dashboard</a>
      </Button>
    );

    const link = screen.getByTestId('link');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/dashboard');
    // The child carries the full recipe...
    expect(tokens(link.className)).toEqual(tokens(composed({})));
    // ...and there is no button role anywhere: exactly one element was rendered.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  // Regression: the child's own `className` survives the swap. `Slot` merges the
  // button's class onto the child, and the child's own classes have to survive
  // alongside it -- a swap that replaced the child's class list would silently
  // strip whatever the link styled itself with.
  it('keeps the child element own classes when merging into it', () => {
    render(
      <Button asChild variant="ghost" size="sm" data-testid="link">
        <a className="uppercase" href="/pricing">
          Pricing
        </a>
      </Button>
    );

    const link = screen.getByTestId('link');
    expect(link).toHaveClass('uppercase');
    expect(tokens(link.className)).toEqual(
      expect.arrayContaining([...VARIANT_MARKERS.ghost, ...SIZE_MARKERS.sm])
    );
    // And the child's classes come last, so they win a conflict.
    expect(link.className.indexOf('uppercase')).toBeGreaterThan(
      link.className.indexOf('inline-flex')
    );
  });

  // Regression: the variant and size props reach the recipe on the rendered
  // element. Without this, a component could accept `variant` and pass something
  // else, and every call site would still compile.
  it('applies the selected variant and size to the rendered button', () => {
    render(
      <Button variant="destructive" size="lg" data-testid="btn">
        Delete
      </Button>
    );

    const out = tokens(screen.getByTestId('btn').className);
    for (const marker of [...VARIANT_MARKERS.destructive, ...SIZE_MARKERS.lg]) {
      expect(out).toContain(marker);
    }
    for (const marker of VARIANT_MARKERS.default) {
      expect(out).not.toContain(marker);
    }
  });

  // Regression: `ref` forwarding, plus the `{...props}` spread. The ref is how a
  // caller focuses a button after a dialog opens; the spread is how `type`,
  // `disabled`, `form` and the event handlers reach the element. `onClick` is
  // asserted as *called* rather than as a present prop, because a spread that
  // dropped handlers would still leave the attributes in place.
  it('forwards its ref and its props to the button element', () => {
    const nodes: HTMLButtonElement[] = [];
    const onClick = vi.fn<(event: React.MouseEvent<HTMLButtonElement>) => void>();

    render(
      <Button
        ref={node => {
          if (node) nodes.push(node);
        }}
        id="save-file"
        type="submit"
        form="file-form"
        onClick={onClick}
        data-testid="btn"
      >
        Save
      </Button>
    );

    const button = screen.getByTestId('btn');
    expect(button).toHaveAttribute('id', 'save-file');
    expect(button).toHaveAttribute('type', 'submit');
    expect(button).toHaveAttribute('form', 'file-form');
    expect(nodes).toEqual([button]);

    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  // Regression: `disabled` reaches the element, and the `disabled:*` utilities the
  // base declares are what make it *look* disabled. A spread that dropped
  // `disabled` would leave a button that looks inert and still submits the form.
  it('keeps the disabled state on the element and its disabled styling', () => {
    render(
      <Button disabled data-testid="btn">
        Save
      </Button>
    );

    const button = screen.getByTestId('btn');
    expect(button).toBeDisabled();
    expect(button).toHaveClass('disabled:pointer-events-none', 'disabled:opacity-50');
  });

  // Regression: the `className` prop is consumed by the recipe rather than
  // forwarded as a second attribute, and `cn` resolves a conflict in the caller's
  // favour. Reversed, an explicit colour would be dropped while the button kept
  // looking like a button -- the exact class of regression that is invisible in
  // behaviour and obvious only on screen.
  it('resolves a conflicting caller class in the caller favour', () => {
    render(
      <Button className="bg-red-500" data-testid="btn">
        Save
      </Button>
    );

    const out = tokens(screen.getByTestId('btn').className);
    expect(out).toContain('bg-red-500');
    // `bg-primary` conflicts with it and loses -- token-wise, not textually:
    // `bg-primary/90` survives, and `not.toContain` on the raw string would fail
    // on that substring.
    expect(out).not.toContain('bg-primary');
    expect(out).toContain('hover:bg-primary/90');
    // Everything non-conflicting is still there.
    for (const cls of BASE_CLASSES) {
      expect(out).toContain(cls);
    }
    for (const marker of SIZE_MARKERS.default) {
      expect(out).toContain(marker);
    }
  });
});
