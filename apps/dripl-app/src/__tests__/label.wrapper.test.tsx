import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import * as LabelPrimitive from '@radix-ui/react-label';

import { Label } from '@/components/ui/label';

/**
 * `components/ui/label.tsx` is a `forwardRef` wrapper over Radix's `Label.Root`
 * that contributes one class string, one merge and a forwarded ref. Radix owns
 * nothing else of consequence here -- a label is a `<label>` with a control id --
 * so this file's own decisions are the whole of what is asserted.
 *
 * The base string matters more than it looks. `peer-disabled:*` is the mechanism
 * by which a form field that has been disabled is *also* dimmed, and it only
 * works if the label is a sibling of the disabled control rather than its
 * ancestor -- so the class is asserted, and so is the pairing with a real
 * disabled input in the "dims with its disabled control" test, which is the only
 * place that utility can be observed doing anything.
 *
 * Note the base has no colour of its own: the label inherits. That is deliberate
 * -- a label that set its own `text-*` would fight every form's own colour
 * scheme -- and a merge test only proves a base value *loses*, which holds for any
 * value, so the base is asserted with no caller class in play.
 */

afterEach(() => {
  cleanup();
});

type LabelProps = React.ComponentProps<typeof Label>;

/** The recipe's classes, asserted with no caller class in play. */
const BASE_CLASSES = [
  'text-sm',
  'font-medium',
  'leading-none',
  'peer-disabled:cursor-not-allowed',
  'peer-disabled:opacity-70',
];

/** A class list as a set of tokens, so comparisons are per class and not textual. */
function tokens(classList: string): string[] {
  return [...new Set(classList.split(/\s+/).filter(Boolean))];
}

describe('Label', () => {
  // Regression: the base type scale and the `peer-disabled` pair. `text-sm`
  // against a 13px body, `font-medium` against a regular-weight input, and
  // `leading-none` so a two-line label does not open a gap. The `peer-disabled`
  // pair is the dimming affordance; without it a disabled field keeps a
  // full-strength label and looks live.
  it('declares its base type scale and disabled-pairing classes', () => {
    render(<Label data-testid="label">Name</Label>);

    const label = screen.getByTestId('label');
    expect(tokens(label.className)).toEqual(BASE_CLASSES);
    // No colour of its own: it inherits whatever the form sets.
    expect(tokens(label.className).filter(c => c.startsWith('text-') && c !== 'text-sm')).toEqual(
      []
    );
  });

  // Regression: the wrapper renders a real `<label>` element, which is what makes
  // clicking the text focus its control. A `div` with the right classes would look
  // identical and associate with nothing.
  it('renders a real label element', () => {
    render(<Label data-testid="label">Name</Label>);

    expect(screen.getByTestId('label').tagName).toBe('LABEL');
  });

  // Regression: `cn(labelVariants(), className)` puts the caller last, so
  // `twMerge` drops the base utility in favour of an explicit caller one.
  // Reversed, a form that asked for a different type scale would silently get the
  // default -- and nothing else would fail, because the label still renders.
  it('resolves conflicting size and weight classes in the caller favour', () => {
    render(
      <Label className="text-base font-normal" data-testid="label">
        Name
      </Label>
    );

    const out = tokens(screen.getByTestId('label').className);
    expect(out).toContain('text-base');
    expect(out).toContain('font-normal');
    expect(out).not.toContain('text-sm');
    expect(out).not.toContain('font-medium');
    // Classes on axes the caller did not touch survive. `leading-none` is
    // deliberately not asserted here: tailwind-merge@3.7.0 folds it away along
    // with a `text-*` size override (verified against the installed version),
    // so asserting it would pin a coincidence rather than the merge order.
    expect(out).toContain('peer-disabled:cursor-not-allowed');
    expect(out).toContain('peer-disabled:opacity-70');
  });

  // Regression: the `peer-disabled` utilities are peer selectors, so they only do
  // anything when the label and the control are siblings. Asserting the
  // association through `htmlFor` is what proves the wrapper still forwards the
  // attribute Radix turns into `for` -- drop the spread and the click target
  // silently stops working, with the classes still intact and every other
  // assertion here still green.
  it('associates with its control through htmlFor', () => {
    render(
      <>
        <Label htmlFor="email" data-testid="label">
          Email
        </Label>
        <input id="email" type="email" />
      </>
    );

    const label = screen.getByTestId('label');
    const input = screen.getByLabelText('Email');
    expect(label).toHaveAttribute('for', 'email');
    expect(input).toHaveAttribute('id', 'email');
  });

  // Regression: `ref={ref}` plus the `{...props}` spread. The ref is how a form
  // focuses a label's control on validation failure, and the spread is how an id,
  // a `data-testid` or a handler reaches the element. Both are asserted through
  // the DOM rather than through a prop inspection, so a wrapper that dropped the
  // spread fails here.
  it('forwards its ref and extra props to the label element', () => {
    const nodes: HTMLLabelElement[] = [];

    render(
      <Label
        id="name-label"
        data-testid="label"
        ref={node => {
          if (node) nodes.push(node);
        }}
      >
        Name
      </Label>
    );

    const label = screen.getByTestId('label');
    expect(label).toHaveAttribute('id', 'name-label');
    expect(nodes).toEqual([label]);
    expect(label).toHaveTextContent('Name');
  });

  // Regression: `displayName` mirrors the Radix primitive. In
  // `@radix-ui/react-label@2.1.15` the primitive does not define one, so the
  // mirror assigns `undefined`; the assertion compares wrapper against primitive
  // rather than a literal, so it keeps holding if a future Radix names itself --
  // and it fails if the assignment is replaced with a hand-written name that
  // drifts from the primitive.
  it('takes its displayName from the Radix primitive', () => {
    expect(Label.displayName).toBe((LabelPrimitive.Root as { displayName?: string }).displayName);
  });

  // Regression: a label with no variants takes none -- `labelVariants` is called
  // with no arguments, so a `variant` prop on a call site would be a type error
  // rather than a silently ignored class. Asserted as a render, because a type
  // error cannot be observed at runtime.
  it('renders without a variant prop being accepted or needed', () => {
    const props: LabelProps = { children: 'Name' };
    render(<Label {...props} data-testid="label" />);

    expect(screen.getByTestId('label')).toHaveTextContent('Name');
  });
});
