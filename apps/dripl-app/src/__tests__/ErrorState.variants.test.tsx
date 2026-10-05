import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ErrorState,
  InlineError,
  LoadingState,
  SuccessState,
  WarningBanner,
} from '@/components/ui/ErrorState';

/**
 * `components/ui/ErrorState.tsx`: five presentational states the app surfaces
 * instead of a blank screen.
 *
 * Nothing here is shared infrastructure -- these are hand-written components, so
 * every class string, role and conditional is this file's own decision and a
 * change to any of them is invisible to the rest of the suite. Two of those
 * decisions carry real weight:
 *
 *   role/aria-live -- `error` is `role="alert"` with `aria-live="assertive"`,
 *     while the non-error variants are `role="status"` with `polite`. That is the
 *     difference between a screen reader interrupting a user mid-sentence to
 *     announce a failure and waiting for a pause. It is derived from `variant`, so
 *     it is asserted per variant rather than once.
 *   the two dismiss affordances -- `ErrorState` renders a "Dismiss" *text* button
 *     in the action row **and** an icon button with an aria-label. Both call
 *     `onDismiss`. That is deliberate (one is the discoverable action, one is the
 *     corner affordance) and it is why the handler is asserted being called twice
 *     rather than once.
 *
 * The colour maps are keyed by `variant` and indexed directly, so a typo in a key
 * would render `undefined` classes. Each variant's own palette is asserted with no
 * override in play, because a merge test only proves a base value *loses*.
 */

afterEach(() => {
  cleanup();
});

/**
 * The root element a component rendered.
 *
 * These components take no `data-testid` -- their props are fixed interfaces with
 * no test hook -- so the root is identified structurally: the single element the
 * render produced. Going through the container rather than through a role keeps
 * one query working for every variant, since the role is itself under test.
 */
/**
 * The lucide class name a variant's icon carries.
 *
 * Read off the rendered `<svg>` rather than imported from `lucide-react`, so the
 * assertion is "this variant drew *this* icon" rather than "this variant drew the
 * icon the source names". `lucide` prefixes every icon, so the second class is the
 * stable identifier: `circle-alert`, `triangle-alert`, `info`.
 */
function iconName(container: HTMLElement): string {
  const icon = container.querySelector('svg');
  if (!icon) throw new Error('no icon rendered');
  const name = icon
    .getAttribute('class')
    ?.split(' ')
    .find(c => c.startsWith('lucide-') && c !== 'lucide');
  if (!name) throw new Error(`icon has no lucide class: ${icon.getAttribute('class')}`);
  return name;
}

/**
 * The row that holds the retry/dismiss buttons.
 *
 * Identified by its own base class string rather than by a role, because with no
 * handler the row renders as an empty `<div>` that no role query can find -- and
 * that empty row is exactly what the "no actions" assertion has to catch.
 */
function actionRow(container: HTMLElement): HTMLElement | null {
  return container.querySelector('div.flex.items-center.gap-2.mt-3');
}

describe('ErrorState', () => {
  it('renders the loudest treatment by default when no variant is given', () => {
    const { container } = render(<ErrorState title="Title" message="Message" />);
    const box = container.firstElementChild as HTMLElement;

    expect(box).toHaveAttribute('role', 'alert');
    expect(box).toHaveAttribute('aria-live', 'assertive');
    expect(box).toHaveClass('bg-[#FEF3F2]', 'border-[#FECACA]');
  });

  // Regression: `role`/`aria-live` are derived from `variant`, not fixed. A
  // non-error variant announced assertively interrupts a screen reader for
  // something that is only a warning or an aside.
  it.each([
    ['error', 'alert', 'assertive'],
    ['warning', 'status', 'polite'],
    ['info', 'status', 'polite'],
  ] as const)('announces a %s state as role=%s with aria-live=%s', (variant, role, live) => {
    const { container } = render(<ErrorState title="T" message="M" variant={variant} />);
    const box = container.firstElementChild as HTMLElement;

    expect(box).toHaveAttribute('role', role);
    expect(box).toHaveAttribute('aria-live', live);
  });

  // Each variant's own palette, asserted with no `className` override in play.
  // These three maps are the only thing distinguishing the variants visually, and
  // the shared base classes are identical across all of them.
  it.each([
    [
      'error',
      'bg-[#FEF3F2]',
      'border-[#FECACA]',
      'text-[#B42318]',
      'text-[#e03131]',
      'lucide-circle-alert',
    ],
    [
      'warning',
      'bg-[#FFFBEB]',
      'border-[#FED7AA]',
      'text-[#92400E]',
      'text-[#d97706]',
      'lucide-triangle-alert',
    ],
    ['info', 'bg-[#EFF6FF]', 'border-[#BFDBFE]', 'text-[#1E40AF]', 'text-[#3B82F6]', 'lucide-info'],
  ] as const)(
    'renders the %s palette on the box, the title, the message and the icon',
    (variant, bg, border, text, iconColor, icon) => {
      const { container } = render(<ErrorState title="T" message="M" variant={variant} />);
      const box = container.firstElementChild as HTMLElement;

      expect(box).toHaveClass(bg, border);
      expect(screen.getByText('T')).toHaveClass(text);
      expect(screen.getByText('M')).toHaveClass(text);
      expect(box.querySelector('svg')).toHaveClass(iconColor);
      // The icon *identity*, not just its colour: two variants share a palette
      // shape and a wrong icon would otherwise only be caught by colour on one of
      // them.
      expect(iconName(container)).toBe(icon);
    }
  );

  // Regression: the shared base. `t-error-msg` is a test/analytics hook, so its
  // presence is a contract with whatever reads it rather than a style.
  it('always renders the shared base classes and the error-message hook', () => {
    const { container } = render(<ErrorState title="T" message="M" />);

    expect(container.firstElementChild).toHaveClass('rounded-lg', 'border', 'p-4', 't-error-msg');
  });

  // Regression: the `cn` merge. Caller last, so an explicit background wins over
  // the variant's -- reversed, the palette would be unoverridable while every
  // variant still looked right on its own.
  it('resolves a conflicting background in the caller favour', () => {
    const { container } = render(
      <ErrorState title="T" message="M" variant="warning" className="bg-red-500" />
    );
    const box = container.firstElementChild as HTMLElement;

    expect(box).toHaveClass('bg-red-500');
    expect(box.className).not.toContain('bg-[#FFFBEB]');
    // Non-conflicting base utilities survive the merge.
    expect(box).toHaveClass('rounded-lg', 't-error-msg');
  });

  // Regression: the action row is conditional. With neither handler the row is
  // not rendered at all -- an empty flex row would still occupy space below the
  // message.
  it('renders no action row when neither handler is given', () => {
    const { container } = render(<ErrorState title="T" message="M" />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('Try again')).toBeNull();
    expect(screen.queryByText('Dismiss')).toBeNull();
    // The row itself is gone, not merely empty. Asserting only "no buttons" would
    // pass for an always-rendered row, which still reserves a row's worth of
    // vertical space below the message.
    expect(actionRow(container)).toBeNull();
  });

  it('renders the action row exactly once when a handler is given', () => {
    const { container } = render(<ErrorState title="T" message="M" onRetry={() => undefined} />);

    expect(container.querySelectorAll('div.flex.items-center.gap-2.mt-3')).toHaveLength(1);
  });

  it('renders only the retry button when only onRetry is given', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();

    render(<ErrorState title="T" message="M" onRetry={onRetry} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent('Try again');
    await user.click(buttons[0]!);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  // Regression: the two dismiss affordances. `onDismiss` produces BOTH a text
  // button in the action row and a labelled icon button, so the handler is
  // reachable two ways. Asserting a single call would have hidden one of them.
  it('gives onDismiss two affordances, and both call the same handler', async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();

    render(<ErrorState title="T" message="M" onDismiss={onDismiss} />);

    expect(screen.getAllByRole('button')).toHaveLength(2);
    // The text affordance is a bare button with no icon; the corner one carries
    // only an X and is reachable by its label. Neither has the other's label, so
    // `getByText` and the labelled-role query cannot return the same node.
    const textButton = screen.getByText('Dismiss');
    const iconButton = screen.getByRole('button', { name: 'Dismiss notification' });

    expect(textButton.tagName).toBe('BUTTON');
    expect(textButton.querySelector('svg')).toBeNull();
    expect(iconButton.querySelector('svg')).not.toBeNull();
    expect(textButton).not.toBe(iconButton);

    await user.click(textButton);
    await user.click(iconButton);
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it('renders both actions when both handlers are given, each wired to its own handler', async () => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    const user = userEvent.setup();

    render(<ErrorState title="T" message="M" onRetry={onRetry} onDismiss={onDismiss} />);

    // Retry + Dismiss text + Dismiss icon.
    expect(screen.getAllByRole('button')).toHaveLength(3);
    await user.click(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the title as a heading and the message as a paragraph', () => {
    render(<ErrorState title="Could not load file" message="The server said no." />);

    const title = screen.getByRole('heading', { name: 'Could not load file' });
    expect(title.tagName).toBe('H4');
    expect(title).toHaveClass('text-[14px]', 'font-semibold', 'mb-1');
    expect(screen.getByText('The server said no.').tagName).toBe('P');
  });

  it('declares no button type on its actions, so they cannot submit a surrounding form', () => {
    // The `type="button"` on each of the three buttons is load-bearing inside a
    // form: without it a dismiss click would submit the page.
    render(
      <form onSubmit={e => e.preventDefault()}>
        <ErrorState title="T" message="M" onRetry={() => undefined} onDismiss={() => undefined} />
      </form>
    );

    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAttribute('type', 'button');
    }
  });
});

describe('InlineError', () => {
  // Regression: `message` is a `ReactNode`, not a `string`. It was once a string,
  // and a caller had to render `typeof error === 'string' ? error : 'An error
  // occurred'`, discarding the "resend verification" link it had just built. A
  // node in the message must therefore reach the DOM as rendered markup.
  it('renders a node message with its interactive content intact', () => {
    render(
      <InlineError
        message={
          <>
            Verify your email. <a href="/resend">Resend verification</a>
          </>
        }
      />
    );

    const link = screen.getByRole('link', { name: 'Resend verification' });
    expect(link).toHaveAttribute('href', '/resend');
    expect(link.closest('p')).toHaveTextContent('Verify your email.');
  });

  it('renders a plain string message', () => {
    render(<InlineError message="Something went wrong" />);

    expect(screen.getByText('Something went wrong').tagName).toBe('P');
  });

  it('is always an assertive alert, with the error hook and palette', () => {
    render(<InlineError message="M" />);

    const box = screen.getByRole('alert');
    expect(box).toHaveClass('t-error-msg');
    expect(box).toHaveClass('bg-[#FEF3F2]', 'border-[#FECACA]', 'rounded-md');
    // The inline variant is fixed at the error palette -- there is no `variant`
    // prop -- so the role cannot vary either.
    expect(box.querySelector('svg')).toHaveClass('text-[#e03131]', 'w-4', 'h-4');
    expect(iconName(screen.getByRole('alert').ownerDocument.body)).toBe('lucide-circle-alert');
  });

  // Regression: the retry button is conditional, and the merge is caller-last.
  it('renders no retry button without an onRetry', () => {
    render(<InlineError message="M" />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('wires the retry button to onRetry and merges the caller class', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();

    render(<InlineError message="M" onRetry={onRetry} className="bg-blue-500" />);

    const button = screen.getByRole('button', { name: 'Retry' });
    expect(button).toHaveAttribute('type', 'button');
    await user.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
    const box = screen.getByRole('alert');
    expect(box).toHaveClass('bg-blue-500');
    expect(box.className).not.toContain('bg-[#FEF3F2]');
  });
});

describe('SuccessState', () => {
  // `role="status"` with `aria-live="polite"`, unconditionally -- a success notice
  // must never interrupt.
  it('is a polite status with its own green palette', () => {
    const { container } = render(<SuccessState title="Saved" />);
    const box = container.firstElementChild as HTMLElement;

    expect(box).toHaveAttribute('role', 'status');
    expect(box).toHaveAttribute('aria-live', 'polite');
    expect(box).toHaveClass('bg-[#F0FDF4]', 'border-[#BBF7D0]', 'rounded-lg', 'p-4');
    expect(screen.getByText('Saved')).toHaveClass('text-[#065F46]');
    expect(box.querySelector('svg')).toHaveClass('text-[#059669]', 'w-5', 'h-5');
    expect(iconName(container)).toBe('lucide-circle-check-big');
  });

  // Regression: `message` is optional and the paragraph is conditional, so an
  // omitted message must not leave an empty element.
  it('omits the message paragraph when no message is given', () => {
    render(<SuccessState title="Saved" />);

    expect(screen.getByText('Saved').tagName).toBe('H4');
    expect(screen.getByRole('status').querySelectorAll('p')).toHaveLength(0);
  });

  it('renders the message when one is given', () => {
    render(<SuccessState title="Saved" message="Your file is on disk." />);

    expect(screen.getByText('Your file is on disk.').tagName).toBe('P');
  });

  // Regression: the truthiness guard, not merely `!== undefined`. An empty
  // message is the falsy-but-present case, and `{message && <p/>}` renders `''`
  // -- producing no paragraph -- while `{message !== undefined && <p/>}` renders
  // an empty one. The two are only distinguishable on that input, which is why it
  // is asserted here.
  it('renders no paragraph for an empty message, not an empty one', () => {
    render(<SuccessState title="Saved" message="" />);

    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.getByRole('status').querySelectorAll('p')).toHaveLength(0);
  });

  it('renders no dismiss button without onDismiss', () => {
    render(<SuccessState title="Saved" />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('wires the labelled dismiss button to onDismiss and merges the caller class', async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();

    const { container } = render(
      <SuccessState title="Saved" className="bg-white" onDismiss={onDismiss} />
    );

    const button = screen.getByRole('button', { name: 'Dismiss success notification' });
    expect(button).toHaveAttribute('type', 'button');
    await user.click(button);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    const box = container.firstElementChild as HTMLElement;
    expect(box).toHaveClass('bg-white');
    expect(box.className).not.toContain('bg-[#F0FDF4]');
  });
});

describe('WarningBanner', () => {
  it('is a polite status with its own amber palette', () => {
    const { container } = render(<WarningBanner message="Storage is almost full" />);
    const box = container.firstElementChild as HTMLElement;

    expect(box).toHaveAttribute('role', 'status');
    expect(box).toHaveAttribute('aria-live', 'polite');
    expect(box).toHaveClass('bg-[#FFFBEB]', 'border-[#FED7AA]', 'rounded-md');
    expect(screen.getByText('Storage is almost full')).toHaveClass('text-[#92400E]');
    expect(box.querySelector('svg')).toHaveClass('text-[#d97706]');
    expect(iconName(container)).toBe('lucide-triangle-alert');
  });

  // Regression: the action label is data, not a fixed string, and it is paired
  // with `action.onClick`. Asserting the rendered text and the call separately is
  // what catches a label/hardcoded-button mix-up.
  it('renders the action label and wires it to action.onClick', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(<WarningBanner message="M" action={{ label: 'Upgrade plan', onClick }} />);

    const button = screen.getByRole('button', { name: 'Upgrade plan' });
    expect(button).toHaveAttribute('type', 'button');
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders no action button without an action', () => {
    render(<WarningBanner message="M" />);

    // Only a dismiss button would be here, and there is none without onDismiss.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders both actions when both are given, each wired to its own handler', async () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();
    const user = userEvent.setup();

    render(
      <WarningBanner
        message="M"
        action={{ label: 'Upgrade plan', onClick }}
        onDismiss={onDismiss}
      />
    );

    expect(screen.getAllByRole('button')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Dismiss warning' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('merges the caller class in the caller favour', () => {
    const { container } = render(<WarningBanner message="M" className="bg-red-500" />);
    const box = container.firstElementChild as HTMLElement;

    expect(box).toHaveClass('bg-red-500');
    expect(box.className).not.toContain('bg-[#FFFBEB]');
  });
});

describe('LoadingState', () => {
  // Regression: the default message. A loading surface with no text is
  // indistinguishable from a blank one for a screen reader.
  it('defaults its message to Loading...', () => {
    render(<LoadingState />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders a supplied message instead of the default', () => {
    render(<LoadingState message="Loading your canvas..." />);

    expect(screen.getByText('Loading your canvas...')).toBeInTheDocument();
    expect(screen.queryByText('Loading...')).toBeNull();
  });

  // Regression: the busy semantics. `aria-busy` plus `role="status"` is what tells
  // assistive tech the content is in flight rather than merely empty.
  it('marks itself busy and hides the spinner from assistive tech', () => {
    const { container } = render(<LoadingState />);
    const box = container.firstElementChild as HTMLElement;

    expect(box).toHaveAttribute('role', 'status');
    expect(box).toHaveAttribute('aria-live', 'polite');
    expect(box).toHaveAttribute('aria-busy', 'true');
    const spinner = box.querySelector('[aria-hidden="true"]');
    expect(spinner).not.toBeNull();
    expect(spinner).toHaveClass('animate-spin', 'border-[#3B82F6]');
  });

  it('merges the caller class', () => {
    const { container } = render(<LoadingState className="py-10" />);
    const box = container.firstElementChild as HTMLElement;

    expect(box).toHaveClass('py-10');
    expect(box).toHaveClass('flex', 'items-center', 'justify-center');
  });
});
