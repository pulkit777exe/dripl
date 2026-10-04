import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

class MockResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

vi.stubGlobal('ResizeObserver', MockResizeObserver);

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

describe('dropdown-menu unchecked indicators', () => {
  // Regression: the check/circle indicators live in a gutter that is always
  // rendered, with the glyph itself gated on `checked`. If the gate were
  // inverted (or the ItemIndicator dropped), an unchecked item would show a tick
  // and read as selected — a silently wrong state in any multi-select menu.
  it('leaves the gutter empty when a checkbox item is unchecked', () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem>Unchecked</DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    const item = screen.getByRole('menuitemcheckbox');
    expect(item).toHaveAttribute('aria-checked', 'false');
    // The gutter span is still there so checked/unchecked rows stay aligned...
    expect(item.querySelector('span.absolute')).not.toBeNull();
    // ...but carries no glyph.
    expect(item.querySelector('span.absolute')?.querySelector('svg')).toBeNull();
  });

  // Regression: same as above for the radio dot. A permanently-drawn circle
  // makes every option in a radio group look chosen.
  it('leaves the gutter empty when a radio item is unchecked', () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value="b">
            <DropdownMenuRadioItem value="a">Alpha</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="b">Bravo</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    const alpha = screen.getByRole('menuitemradio', { name: /alpha/i });
    const bravo = screen.getByRole('menuitemradio', { name: /bravo/i });

    // Exactly one item in a radio group is checked; the other has an empty gutter.
    expect(alpha).toHaveAttribute('aria-checked', 'false');
    expect(alpha.querySelector('span.absolute')?.querySelector('svg')).toBeNull();
    expect(bravo).toHaveAttribute('aria-checked', 'true');
    expect(bravo.querySelector('span.absolute')?.querySelector('svg')).not.toBeNull();
  });

  // Regression: `checked` is destructured out of props and re-passed to the
  // primitive. If that pass-through were dropped, Radix would fall back to
  // uncontrolled state and every item would render as unchecked regardless of
  // what the caller passed.
  it('forwards the caller-controlled checked state verbatim', () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem checked>On</DropdownMenuCheckboxItem>
          <DropdownMenuRadioGroup value="a">
            <DropdownMenuRadioItem value="a">Alpha</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    expect(screen.getByRole('menuitemcheckbox')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: /alpha/i })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });
});

describe('dropdown-menu prop forwarding', () => {
  // Regression: every wrapper ends in `{...props}`. Losing the spread silently
  // drops the props a caller needs to make an item work — here `onSelect`, plus
  // the data-* hook the design-system tests rely on. Nothing else in the chain
  // would surface the omission.
  it('forwards event handlers and data attributes to the underlying primitive', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onSelect} data-testid="item-a">
            Item A
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    // data-* reached the DOM through the spread.
    const item = screen.getByRole('menuitem', { name: /item a/i });
    expect(item).toHaveAttribute('data-testid', 'item-a');

    await user.click(item);

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  // Regression: DropdownMenuSubContent carries the z-index/popover/animation
  // classes that keep a nested menu stacked above its parent. Losing the cn()
  // merge — or swapping the argument order so a caller's class no longer wins —
  // drops `z-50` and stops the caller from overriding anything.
  // `defaultOpen` on the Sub is ignored by Radix, so the trigger is activated to
  // reach the submenu content. Only the rendered classes are asserted here.
  it('renders the submenu content with its base classes and the caller class last', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent className="w-72" data-testid="subcontent">
                <DropdownMenuItem>Nested</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    await user.click(screen.getByRole('menuitem', { name: /more/i }));

    const submenu = screen.getByTestId('subcontent');
    expect(submenu.className).toContain('z-50');
    expect(submenu.className).toContain('bg-popover');
    expect(submenu.className.indexOf('w-72')).toBeGreaterThan(
      submenu.className.indexOf('bg-popover')
    );
    // The nested item is reachable, so this is real rendered output, not a stub.
    expect(screen.getByRole('menuitem', { name: /nested/i })).toBeInTheDocument();
  });
});

describe('dropdown-menu composition', () => {
  // Regression: the primitives are re-exported as bare aliases. Group,
  // SubTrigger and RadioGroup are structural wrappers with no styling of their
  // own — if a re-export were renamed or re-pointed, any menu composed of them
  // would fail to render rather than degrade quietly.
  it('composes a labelled group inside a submenu without losing any part', () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Section</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Nested</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
          <DropdownMenuItem>Plain</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    // Everything inside the open root menu is present and reachable.
    expect(screen.getByRole('menuitem', { name: /more/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /plain/i })).toBeInTheDocument();
    expect(screen.getByText('Section')).toBeInTheDocument();

    // Radix keeps the closed submenu's content unmounted, so its absence is the
    // correct state — asserted here so a wrapper that eagerly rendered it (and
    // so left focusable items outside the open menu) would be caught.
    expect(screen.queryByRole('menuitem', { name: /nested/i })).not.toBeInTheDocument();
  });
});
