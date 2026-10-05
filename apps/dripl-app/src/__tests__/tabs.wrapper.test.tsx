import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as TabsPrimitive from '@radix-ui/react-tabs';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * `components/ui/tabs.tsx` is four exports: one alias of Radix's `Root`, and three
 * `forwardRef` wrappers that contribute nothing but a class string, a `cn()` merge
 * and a forwarded ref.
 *
 * Radix owns selection, roving focus, the `data-state` attributes and the
 * `aria-selected` wiring; none of that is asserted here, because a test for it
 * would be a test for `@radix-ui/react-tabs`. What *is* this file's decision, and
 * what therefore belongs here:
 *
 *   merge order -- `cn(base, className)` puts the caller last, so `twMerge` drops
 *                   the base utility in favour of an explicit caller one.
 *                   Reversing the arguments breaks every override in the app while
 *                   every wrapper still renders, so the direction has to be pinned.
 *   the base string itself -- a merge test only proves the base *loses*, which
 *                   holds for any value. Each base class list is asserted
 *                   separately with no caller class in play.
 *   displayName mirroring -- each wrapper copies `displayName` off the Radix
 *                   primitive. In `@radix-ui/react-tabs@1.1.21` the primitives do
 *                   not define one, so the copies assign `undefined`; the
 *                   assertions below therefore compare the wrapper against the
 *                   primitive rather than against a literal, which is what makes
 *                   them hold whether or not a future Radix names itself.
 *   `Tabs` being a bare re-export -- if it were wrapped, `Tabs`'s own props would
 *                   silently stop reaching Radix.
 *
 * One limit is worth naming, because it is a property of `twMerge` rather than of
 * this file: the `data-[state=active]:*` utilities on `TabsTrigger` are variant
 * scoped, so a caller cannot override them with an unprefixed `bg-*`. Only the
 * unprefixed base utilities are overridable, and those are what is asserted.
 */

afterEach(() => {
  cleanup();
});

/**
 * The prop bags the helper accepts, per slot.
 *
 * `value` is omitted because the helper supplies it, and it is re-applied after the
 * spread so a test cannot accidentally deselect the panel. `ref` is added back on:
 * `ComponentPropsWithoutRef` strips it, and forwardRef forwarding is one of the
 * things under test.
 */
type ListSlot = React.ComponentProps<typeof TabsList>;
type TriggerSlot = Omit<React.ComponentProps<typeof TabsTrigger>, 'value'>;
type ContentSlot = Omit<React.ComponentProps<typeof TabsContent>, 'value'>;

/** A trigger and panel inside a `Tabs` whose first value is selected. */
function renderTabs(
  listProps: ListSlot = {},
  triggerProps: TriggerSlot = {},
  contentProps: ContentSlot = {}
) {
  return render(
    <Tabs defaultValue="a">
      <TabsList data-testid="list" {...listProps}>
        <TabsTrigger {...triggerProps} value="a" data-testid="trigger" />
      </TabsList>
      <TabsContent {...contentProps} value="a" data-testid="content">
        panel
      </TabsContent>
    </Tabs>
  );
}

describe('Tabs', () => {
  // Regression: `Tabs` is `TabsPrimitive.Root` itself, not a wrapper. A wrapper
  // that dropped `value`/`onValueChange`/`defaultValue` would leave a tab set
  // that can never change, and the failure is invisible until someone clicks.
  it('is the Radix root, so its own props reach the primitive', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn<(value: string) => void>();

    render(
      <Tabs defaultValue="b" onValueChange={onValueChange} data-testid="root">
        <TabsList>
          <TabsTrigger value="a" data-testid="trigger-a">
            A
          </TabsTrigger>
          <TabsTrigger value="b" data-testid="trigger-b">
            B
          </TabsTrigger>
        </TabsList>
        <TabsContent value="a" data-testid="content-a">
          Panel A
        </TabsContent>
        <TabsContent value="b" data-testid="content-b">
          Panel B
        </TabsContent>
      </Tabs>
    );

    // `defaultValue` chose B, not A. A wrapper that dropped the root's own props
    // and defaulted to a hardcoded value would still render a working tab set --
    // it would just open on the wrong tab.
    expect(screen.getByTestId('trigger-b')).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('trigger-a')).toHaveAttribute('data-state', 'inactive');
    expect(screen.getByTestId('content-b')).toBeVisible();
    expect(screen.getByTestId('content-a')).not.toBeVisible();
    expect(onValueChange).not.toHaveBeenCalled();

    // And `onValueChange` is the root's own: a change notifies it, and only it.
    await user.click(screen.getByTestId('trigger-a'));
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange.mock.calls[0]![0]).toBe('a');
  });

  // Regression: an *uncontrolled* tab set must still move. With
  // `defaultValue` alone, Radix owns the selection, so a wrapper that pinned
  // `value` would leave the set stuck on its first tab with no error anywhere.
  it('moves between values when left uncontrolled', async () => {
    const user = userEvent.setup();

    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a" data-testid="trigger-a">
            A
          </TabsTrigger>
          <TabsTrigger value="b" data-testid="trigger-b">
            B
          </TabsTrigger>
        </TabsList>
        <TabsContent value="a" data-testid="content-a">
          Panel A
        </TabsContent>
        <TabsContent value="b" data-testid="content-b">
          Panel B
        </TabsContent>
      </Tabs>
    );

    expect(screen.getByTestId('trigger-a')).toHaveAttribute('data-state', 'active');

    await user.click(screen.getByTestId('trigger-b'));

    expect(screen.getByTestId('trigger-b')).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('content-b')).toBeVisible();
  });
});

describe('TabsList', () => {
  // Regression: the list is a horizontal pill container. Its `h-9`, `bg-muted` and
  // `p-1` are declared only here, so they are pinned with no caller class in play.
  it('declares its base layout when no className is given', () => {
    renderTabs();

    expect(screen.getByTestId('list')).toHaveClass(
      'inline-flex',
      'h-9',
      'items-center',
      'justify-center',
      'rounded-lg',
      'bg-muted',
      'p-1',
      'text-muted-foreground'
    );
  });

  // Regression: `cn(base, className)` puts the caller last. Reversed, the base
  // `bg-muted`/`h-9`/`p-1` would beat an explicit caller value and every
  // override in the app would be dropped while the component still rendered.
  it('resolves conflicting size, padding and colour classes in the caller favour', () => {
    renderTabs({ className: 'h-16 p-4 bg-red-500' });

    const list = screen.getByTestId('list');
    expect(list).toHaveClass('h-16', 'p-4', 'bg-red-500');
    expect(list.className).not.toContain('h-9');
    expect(list.className).not.toContain('p-1');
    expect(list.className).not.toContain('bg-muted');
    // Non-conflicting base utilities survive the merge.
    expect(list).toHaveClass('inline-flex', 'items-center', 'rounded-lg');
  });

  it('appends the caller classes after the base ones', () => {
    renderTabs({ className: 'w-full' });

    const list = screen.getByTestId('list');
    expect(list.className.indexOf('w-full')).toBeGreaterThan(list.className.indexOf('inline-flex'));
  });

  // Regression: `ref={ref}` plus the `{...props}` spread. Dropping either leaves
  // a list that cannot be measured and cannot carry an id or a handler.
  it('forwards its ref and extra props to the list element', () => {
    const nodes: HTMLElement[] = [];

    renderTabs({
      id: 'tab-list',
      ref: (node: HTMLElement | null) => {
        if (node) nodes.push(node);
      },
    });

    const list = screen.getByTestId('list');
    expect(list).toHaveAttribute('id', 'tab-list');
    expect(nodes).toEqual([list]);
    // The ref reaches the DOM node Radix rendered, not an intermediate element.
    expect(nodes[0]).toHaveAttribute('role', 'tablist');
  });

  it('takes its displayName from the Radix primitive', () => {
    expect(TabsList.displayName).toBe(TabsPrimitive.List.displayName);
  });
});

describe('TabsTrigger', () => {
  // Regression: the trigger's focus ring and disabled treatment are declared only
  // here. A rename to a class that does not exist leaves a keyboard user with no
  // visible focus indicator and no test would notice without this assertion.
  it('declares its base typography and state selectors when no className is given', () => {
    renderTabs();

    const trigger = screen.getByTestId('trigger');
    for (const cls of [
      'inline-flex',
      'items-center',
      'justify-center',
      'whitespace-nowrap',
      'rounded-md',
      'px-3',
      'py-1',
      'text-sm',
      'font-medium',
      'ring-offset-background',
      'transition-all',
      'focus-visible:outline-none',
      'focus-visible:ring-2',
      'focus-visible:ring-ring',
      'focus-visible:ring-offset-2',
      'disabled:pointer-events-none',
      'disabled:opacity-50',
      'data-[state=active]:bg-background',
      'data-[state=active]:text-foreground',
      'data-[state=active]:shadow',
    ]) {
      expect(trigger.className).toContain(cls);
    }
  });

  // Regression: the active-state surface. These are `data-[state=active]:`
  // utilities, so they only take effect if the value Radix supplies on the
  // selected trigger is literally `active`.
  it('pairs the active-state selectors with the state Radix supplies', () => {
    renderTabs();

    const trigger = screen.getByTestId('trigger');
    expect(trigger).toHaveAttribute('data-state', 'active');
    expect(trigger).toHaveAttribute('aria-selected', 'true');
  });

  // Regression: caller override wins on the *unprefixed* base utilities --
  // `px-3`, `py-1` and `text-sm` are the padding and size the trigger ships
  // with, and a caller's explicit values must replace them rather than sitting
  // alongside them and losing to source order in the stylesheet.
  it('resolves conflicting padding and text size in the caller favour', () => {
    renderTabs({}, { className: 'px-6 py-3 text-base bg-red-500' });

    const trigger = screen.getByTestId('trigger');
    expect(trigger).toHaveClass('px-6', 'py-3', 'text-base', 'bg-red-500');
    expect(trigger.className).not.toContain('px-3');
    expect(trigger.className).not.toContain('py-1');
    expect(trigger.className).not.toContain('text-sm');
    // Non-conflicting base utilities survive the merge.
    expect(trigger).toHaveClass('font-medium', 'whitespace-nowrap', 'rounded-md');
  });

  it('forwards its ref and extra props to the trigger button', () => {
    const nodes: HTMLButtonElement[] = [];

    renderTabs(
      {},
      {
        id: 'tab-trigger-a',
        ref: (node: HTMLButtonElement | null) => {
          if (node) nodes.push(node);
        },
      }
    );

    const trigger = screen.getByTestId('trigger');
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('id', 'tab-trigger-a');
    expect(nodes).toEqual([trigger]);
  });

  it('takes its displayName from the Radix primitive', () => {
    expect(TabsTrigger.displayName).toBe(TabsPrimitive.Trigger.displayName);
  });
});

describe('TabsContent', () => {
  // Regression: the panel is offset from the list and carries its own focus ring.
  // Both are declared only here.
  it('declares its base offset and focus ring when no className is given', () => {
    renderTabs();

    const content = screen.getByTestId('content');
    expect(content).toHaveClass(
      'mt-2',
      'ring-offset-background',
      'focus-visible:outline-none',
      'focus-visible:ring-2',
      'focus-visible:ring-ring',
      'focus-visible:ring-offset-2'
    );
  });

  it('resolves conflicting margin in the caller favour', () => {
    renderTabs({}, {}, { className: 'mt-8' });

    const content = screen.getByTestId('content');
    expect(content).toHaveClass('mt-8');
    expect(content.className).not.toContain('mt-2');
    expect(content).toHaveClass('ring-offset-background');
  });

  it('forwards its ref and extra props to the panel', () => {
    const nodes: HTMLDivElement[] = [];

    renderTabs(
      {},
      {},
      {
        id: 'tab-panel-a',
        ref: (node: HTMLDivElement | null) => {
          if (node) nodes.push(node);
        },
      }
    );

    const content = screen.getByTestId('content');
    expect(content).toHaveAttribute('id', 'tab-panel-a');
    expect(content).toHaveTextContent('panel');
    expect(nodes).toEqual([content]);
  });

  it('takes its displayName from the Radix primitive', () => {
    expect(TabsContent.displayName).toBe(TabsPrimitive.Content.displayName);
  });
});
