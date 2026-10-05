import { act, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from '@/components/ThemeToggle';

/**
 * The theme toggle is the only control whose *correct* rendering depends on
 * whether the component has mounted yet, so its first assertion is about a
 * frame that no DOM query will ever see.
 *
 * `renderToStaticMarkup` runs the render pass with no effect flush, which is
 * exactly the pre-hydration frame a browser paints: `mounted` is still false,
 * so the component returns a placeholder instead of a button. Without this the
 * `if (!mounted)` guard could be deleted and every remaining test would still
 * pass, because testing-library always flushes effects before returning.
 */
const { themeState } = vi.hoisted(() => ({
  themeState: {
    resolvedTheme: 'light' as 'light' | 'dark' | undefined,
    setTheme: vi.fn<(theme: string) => void>(),
  },
}));

vi.mock('next-themes', () => ({ useTheme: () => themeState }));

/** The visible button, or a throw — used so no test can silently assert on the placeholder. */
function toggleButton(): HTMLElement {
  return screen.getByRole('button');
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    themeState.resolvedTheme = 'light';
    themeState.setTheme.mockClear();
  });

  it('renders a sized placeholder, not a button, before it has mounted', () => {
    const html = renderToStaticMarkup(<ThemeToggle />);

    // The placeholder reserves the toggle's footprint so hydration does not
    // shift the layout. Asserted from the markup string because no DOM query
    // can observe the pre-effect frame.
    expect(html).toContain('w-9');
    expect(html).not.toContain('<button');
  });

  it('replaces the placeholder with a labelled button once mounted', async () => {
    await act(async () => {
      render(<ThemeToggle />);
    });

    expect(toggleButton()).toBeInTheDocument();
    // Light theme => the control *offers* dark.
    expect(toggleButton()).toHaveAttribute('title', 'Switch to dark mode');
  });

  it('requests dark when the resolved theme is light', async () => {
    await act(async () => {
      render(<ThemeToggle />);
    });

    await act(async () => {
      toggleButton().click();
    });
    expect(themeState.setTheme).toHaveBeenCalledExactlyOnceWith('dark');
  });

  it('requests light when the resolved theme is dark, and says so', async () => {
    themeState.resolvedTheme = 'dark';
    await act(async () => {
      render(<ThemeToggle />);
    });

    expect(toggleButton()).toHaveAttribute('title', 'Switch to light mode');
    await act(async () => {
      toggleButton().click();
    });
    expect(themeState.setTheme).toHaveBeenCalledExactlyOnceWith('light');
  });

  it('flips the icon swap state to match the resolved theme', async () => {
    themeState.resolvedTheme = 'dark';
    let rerender: (ui: React.ReactElement) => void = () => {};
    await act(async () => {
      ({ rerender } = render(<ThemeToggle />));
    });

    // `data-state` is the CSS hook for which of the two stacked icons is
    // visible, so a toggle that flipped the title but not this would animate
    // the wrong icon.
    const swap = () => document.querySelector('.t-icon-swap')!;
    expect(swap().getAttribute('data-state')).toBe('b');

    themeState.resolvedTheme = 'light';
    await act(async () => {
      rerender(<ThemeToggle />);
    });
    expect(swap().getAttribute('data-state')).toBe('a');
  });

  it('treats an unresolved theme as light', async () => {
    // `resolvedTheme` is undefined until next-themes has read localStorage and
    // the media query. The component must not throw or render nothing.
    themeState.resolvedTheme = undefined;
    await act(async () => {
      render(<ThemeToggle />);
    });

    expect(toggleButton()).toHaveAttribute('title', 'Switch to dark mode');
    await act(async () => {
      toggleButton().click();
    });
    expect(themeState.setTheme).toHaveBeenCalledExactlyOnceWith('dark');
  });
});
