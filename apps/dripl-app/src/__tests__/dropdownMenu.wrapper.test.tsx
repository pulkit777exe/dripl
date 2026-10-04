import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Radix measures its trigger to place the content, and jsdom has no
// ResizeObserver. This is a shim for a browser primitive the app does not own;
// nothing here asserts Radix's own positioning behaviour.
class MockResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/**
 * Renders a menu with `defaultOpen` so the items are mounted. Opening a Radix
 * menu is Radix's behaviour; only the markup this wrapper contributes is asserted.
 */
function renderMenu(children: React.ReactNode) {
  return render(
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger>open</DropdownMenuTrigger>
      <DropdownMenuContent>{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('dropdown-menu wrapper classes', () => {
  // Regression: these wrappers are the only place the app's menu styling is
  // declared. Losing the cn() merge of base + caller classes silently restyles
  // every menu in the app, and swapping the argument order lets a caller's
  // utility class lose the Tailwind conflict.
  it('merges caller classes after the base classes on items', () => {
    renderMenu(<DropdownMenuItem className="text-red-500">Item</DropdownMenuItem>);

    const item = screen.getByRole('menuitem');
    expect(item.className).toContain('relative flex cursor-default');
    // The caller's class comes LAST so tailwind-merge resolves a conflict in
    // the caller's favour. Reordering the cn() args would flip this and the
    // base `focus:text-accent-foreground` would win over an explicit colour.
    expect(item.className.indexOf('text-red-500')).toBeGreaterThan(
      item.className.indexOf('focus:text-accent-foreground')
    );
  });

  // Regression: DropdownMenuShortcut renders a plain span, so its alignment and
  // muted styling live only here. A dropped class makes every shortcut sit at the
  // left of its row at full opacity.
  it('renders the shortcut span with its alignment classes and merges overrides', () => {
    renderMenu(
      <DropdownMenuItem>
        Open
        <DropdownMenuShortcut className="text-red-500">⌘O</DropdownMenuShortcut>
      </DropdownMenuItem>
    );

    const shortcut = screen.getByText('⌘O');
    expect(shortcut.tagName).toBe('SPAN');
    expect(shortcut.className).toBe('ml-auto text-xs tracking-widest opacity-60 text-red-500');
  });

  // Regression: `inset` indents a nested item/label to line up under a section
  // header. Dropping the conditional makes indented and flush rows identical.
  it('applies the inset padding only when inset is set', () => {
    const { rerender } = renderMenu(
      <>
        <DropdownMenuLabel inset>Section</DropdownMenuLabel>
        <DropdownMenuItem inset>Inset item</DropdownMenuItem>
        <DropdownMenuItem>Flush item</DropdownMenuItem>
      </>
    );

    expect(screen.getByText('Section')).toHaveClass('px-2', 'py-1.5', 'font-semibold', 'pl-8');
    expect(screen.getByText('Inset item')).toHaveClass('pl-8');
    expect(screen.getByText('Flush item')).not.toHaveClass('pl-8');

    rerender(
      <DropdownMenu defaultOpen>
        <DropdownMenuContent>
          <DropdownMenuLabel>Section</DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    expect(screen.getByText('Section')).not.toHaveClass('pl-8');
  });

  // Regression: the separator is a decorative div; losing `bg-muted` leaves a
  // visible gap where the rule should be.
  it('renders the separator with its rule styling', () => {
    renderMenu(<DropdownMenuSeparator data-testid="rule" />);

    expect(screen.getByTestId('rule')).toHaveClass('-mx-1', 'my-1', 'h-px', 'bg-muted');
  });
});

describe('dropdown-menu item indicators', () => {
  // Regression: the check and radio dots are absolutely positioned inside a
  // reserved left gutter. Dropping the wrapper's `absolute left-2` collapses the
  // gutter and the indicator overlaps the item label.
  it('places the check indicator in a reserved left gutter when checked', () => {
    renderMenu(<DropdownMenuCheckboxItem checked>Checked</DropdownMenuCheckboxItem>);

    const item = screen.getByRole('menuitemcheckbox');
    expect(item).toHaveAttribute('aria-checked', 'true');
    const gutter = item.querySelector('span.absolute');
    expect(gutter).not.toBeNull();
    expect(gutter).toHaveClass('left-2');
    const glyph = gutter!.querySelector('svg');
    // The checkmark glyph specifically — the radio dot is a filled circle, and
    // swapping the two icons makes a checkbox row read as a radio row.
    expect(glyph).toHaveAttribute('class', expect.stringContaining('lucide-check'));
    expect(glyph).toHaveClass('h-4', 'w-4');
  });

  // Regression: the radio dot must be a filled circle, not the checkbox check.
  // Swapping the icon makes every radio group look like a checkbox list.
  it('places a filled circle in the gutter for the selected radio item', () => {
    // A radio item takes its checked state from the enclosing RadioGroup's
    // value, not from a `checked` prop — that is the only supported way to
    // reach a checked radio row.
    renderMenu(
      <DropdownMenuRadioGroup value="b">
        <DropdownMenuRadioItem value="a">Alpha</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="b">Bravo</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    );

    const item = screen.getByRole('menuitemradio', { name: /bravo/i });
    expect(item).toHaveAttribute('aria-checked', 'true');
    const gutter = item.querySelector('span.absolute');
    expect(gutter).not.toBeNull();
    const icon = gutter!.querySelector('svg');
    expect(icon).not.toBeNull();
    // A filled circle specifically, distinct from the checkbox's checkmark.
    expect(icon!.getAttribute('class')).toContain('lucide-circle');
    expect(icon!.getAttribute('class')).toContain('fill-current');
    expect(icon).toHaveClass('h-2', 'w-2');
  });
});

describe('dropdown-menu submenu trigger', () => {
  // Regression: SubTrigger appends its own ChevronRight affordance outside
  // `{...props}`. Losing it removes the only visual cue that an item opens a
  // submenu, and losing the `children` in the JSX body drops the label itself.
  it('renders the submenu label followed by a chevron affordance', () => {
    renderMenu(
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
      </DropdownMenuSub>
    );

    const trigger = screen.getByRole('menuitem', { name: /more/i });
    expect(trigger).toHaveTextContent('More');
    const chevron = trigger.querySelector('svg');
    expect(chevron).not.toBeNull();
    expect(chevron!.getAttribute('class')).toContain('ml-auto');
  });
});

describe('dropdown-menu content', () => {
  // Regression: this wrapper is what portals the menu into document.body. If the
  // Portal is dropped, every menu renders inside its trigger's stacking context
  // and is clipped by ancestor overflow.
  it('portals the menu content to document.body rather than the render container', () => {
    const { container } = renderMenu(<DropdownMenuItem>Item</DropdownMenuItem>);

    expect(container).not.toContainElement(screen.getByRole('menu'));
    expect(document.body).toContainElement(screen.getByRole('menu'));
  });
});
