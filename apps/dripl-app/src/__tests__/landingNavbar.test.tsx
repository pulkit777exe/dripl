import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LandingNavbar } from '@/components/landing/LandingNavbar';

/**
 * `LandingNavbar` is three `useEffect`s over one boolean: a scroll threshold that
 * restyles the bar, an Escape handler that only exists while the mobile menu is
 * open, and a body scroll lock that follows it. The interesting behaviour is all in
 * the listeners — whether they are added, whether they are removed, and whether the
 * removal matches the addition.
 */

function trigger(): HTMLElement {
  return screen.getByRole('button', { name: /open menu|close menu/i });
}

function panel(): HTMLElement {
  const el = document.getElementById('mobile-menu');
  if (!el) throw new Error('mobile-menu panel not found');
  return el;
}

function nav(): HTMLElement {
  return screen.getByRole('navigation');
}

/** Open or close the mobile menu via its hamburger button. */
function toggle(): void {
  fireEvent.click(trigger());
}

/** Drive a window scroll to an absolute offset and fire the event the page listens for. */
function scrollTo(y: number): void {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true });
  fireEvent.scroll(window);
}

beforeEach(() => {
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
  document.body.style.overflow = '';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LandingNavbar — scroll threshold', () => {
  it('is not in the scrolled style at the top of the page', () => {
    render(<LandingNavbar />);
    expect(nav().className).not.toContain('shadow-sm');
    expect(nav().className).toContain('bg-[#F0EDE6]/90');
  });

  it('switches to the scrolled style past the threshold', () => {
    render(<LandingNavbar />);
    scrollTo(200);
    expect(nav().className).toContain('shadow-sm');
    expect(nav().className).toContain('bg-[#F0EDE6]/95');
  });

  it('treats exactly 8px as not scrolled and 9px as scrolled', () => {
    // The source says `window.scrollY > 8`. The boundary is the whole claim, so it is
    // pinned on both sides rather than tested at an arbitrary large offset.
    render(<LandingNavbar />);

    scrollTo(8);
    expect(nav().className).not.toContain('shadow-sm');

    scrollTo(9);
    expect(nav().className).toContain('shadow-sm');
  });

  it('returns to the unscrolled style when scrolled back to the top', () => {
    render(<LandingNavbar />);
    scrollTo(500);
    expect(nav().className).toContain('shadow-sm');

    scrollTo(0);
    expect(nav().className).not.toContain('shadow-sm');
  });

  it('adds exactly one scroll listener and removes that same handler on unmount', () => {
    // Both spies go up before render, or the render-time registration is missed.
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');

    const { unmount } = render(<LandingNavbar />);

    const scrollAdds = add.mock.calls.filter(([type]) => type === 'scroll');
    expect(scrollAdds).toHaveLength(1);
    const handler = scrollAdds[0]![1] as EventListener;
    // Registered passive, so the handler cannot block scrolling — that is the point
    // of the option and it is observable here.
    expect(scrollAdds[0]![2]).toMatchObject({ passive: true });

    unmount();

    const scrollRemoves = remove.mock.calls.filter(([type]) => type === 'scroll');
    // Matched on handler identity, not merely on event name: `removeEventListener`
    // ignores an unrelated function, so asserting the count alone would pass even if
    // the wrong handler were removed and the real one leaked.
    expect(scrollRemoves.some(([, fn]) => fn === handler)).toBe(true);
  });

  it('leaves no scroll listener behind across repeated mount/unmount cycles', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');

    for (let i = 0; i < 3; i += 1) {
      const { unmount } = render(<LandingNavbar />);
      unmount();
    }

    const scrollAdds = add.mock.calls.filter(([type]) => type === 'scroll');
    const scrollRemoves = remove.mock.calls.filter(([type]) => type === 'scroll');
    expect(scrollAdds).toHaveLength(3);
    expect(scrollRemoves).toHaveLength(3);

    const registered = new Set(scrollAdds.map(([, fn]) => fn));
    const unregistered = new Set(scrollRemoves.map(([, fn]) => fn));
    for (const handler of registered) {
      expect(unregistered.has(handler)).toBe(true);
    }
  });
});

describe('LandingNavbar — mobile menu', () => {
  it('starts closed', () => {
    render(<LandingNavbar />);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().getAttribute('aria-label')).toBe('Open menu');
    expect(panel().className).toContain('max-h-0');
    expect(panel().className).toContain('opacity-0');
  });

  it('opens on the hamburger and reports it through aria-expanded', () => {
    render(<LandingNavbar />);
    toggle();

    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().getAttribute('aria-label')).toBe('Close menu');
    expect(panel().className).toContain('max-h-64');
    expect(panel().className).toContain('opacity-100');
  });

  it('closes again on a second press', () => {
    render(<LandingNavbar />);
    toggle();
    toggle();

    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(panel().className).toContain('max-h-0');
  });

  it('marks the collapsed panel aria-hidden and inert, and clears both when open', () => {
    render(<LandingNavbar />);
    expect(panel().getAttribute('aria-hidden')).toBe('true');
    // React renders `inert={false}` by omitting the attribute entirely.
    expect(panel().hasAttribute('inert')).toBe(true);

    toggle();
    expect(panel().getAttribute('aria-hidden')).toBe('false');
    expect(panel().hasAttribute('inert')).toBe(false);
  });

  it('points the trigger at the panel it controls', () => {
    render(<LandingNavbar />);
    expect(trigger().getAttribute('aria-controls')).toBe('mobile-menu');
  });

  it('closes when the sign-up link inside the panel is chosen', () => {
    render(<LandingNavbar />);
    toggle();

    // The third close handler on the panel: FAQ and Sign in are covered above, and
    // this is the `Get started free` link. Each is a separate `onClick` in the source,
    // so each needs its own assertion.
    const signUp = Array.from(panel().querySelectorAll('a')).find(
      a => a.getAttribute('href') === '/signup'
    );
    if (!signUp) throw new Error('mobile sign-up link not found');
    fireEvent.click(signUp);

    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('closes when a link inside the panel is chosen', () => {
    render(<LandingNavbar />);
    toggle();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');

    // The mobile links are inside the collapsed panel, so scope to it rather than
    // matching the desktop set that carries the same hrefs.
    const mobileFaq = Array.from(panel().querySelectorAll('a')).find(a => a.textContent === 'FAQ');
    if (!mobileFaq) throw new Error('mobile FAQ link not found');
    fireEvent.click(mobileFaq);

    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('closes when the sign-in link inside the panel is chosen', () => {
    render(<LandingNavbar />);
    toggle();

    const signIn = Array.from(panel().querySelectorAll('a')).find(
      a => a.textContent === 'Sign in' && a.getAttribute('href') === '/login'
    );
    if (!signIn) throw new Error('mobile sign-in link not found');
    fireEvent.click(signIn);

    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });
});

describe('LandingNavbar — Escape', () => {
  it('closes an open menu', () => {
    render(<LandingNavbar />);
    toggle();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('registers no keydown listener while the menu is closed', () => {
    const add = vi.spyOn(window, 'addEventListener');
    render(<LandingNavbar />);

    // The effect returns early when closed. A listener added unconditionally would
    // cost a window-level handler on every landing-page visitor for no reason.
    const keydown = add.mock.calls.filter(([type]) => type === 'keydown');
    expect(keydown).toHaveLength(0);
  });

  it('registers the keydown listener only while the menu is open', () => {
    render(<LandingNavbar />);
    const add = vi.spyOn(window, 'addEventListener');

    toggle();
    expect(add.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);
  });

  it('removes the keydown listener when the menu closes', () => {
    render(<LandingNavbar />);
    const remove = vi.spyOn(window, 'removeEventListener');
    toggle();
    remove.mockClear();

    toggle(); // close
    const keydown = remove.mock.calls.filter(([type]) => type === 'keydown');
    expect(keydown).toHaveLength(1);
  });

  it('removes the keydown listener on unmount while the menu is open', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const { unmount } = render(<LandingNavbar />);

    toggle();
    const handler = add.mock.calls.filter(([type]) => type === 'keydown')[0]![1] as EventListener;

    const remove = vi.spyOn(window, 'removeEventListener');
    unmount();

    const keydown = remove.mock.calls.filter(([type]) => type === 'keydown');
    expect(keydown.some(([, fn]) => fn === handler)).toBe(true);
  });

  it('ignores other keys while the menu is open', () => {
    render(<LandingNavbar />);
    toggle();

    fireEvent.keyDown(window, { key: 'a' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(trigger().getAttribute('aria-expanded')).toBe('true');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('is a no-op when the menu is already closed', () => {
    render(<LandingNavbar />);
    expect(() => fireEvent.keyDown(window, { key: 'Escape' })).not.toThrow();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });
});

describe('LandingNavbar — body scroll lock', () => {
  it('leaves body overflow alone while the menu is closed', () => {
    render(<LandingNavbar />);
    expect(document.body.style.overflow).toBe('');
  });

  it('locks body scrolling while the menu is open', () => {
    render(<LandingNavbar />);
    toggle();
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('releases the lock when the menu closes', () => {
    render(<LandingNavbar />);
    toggle();
    toggle();
    expect(document.body.style.overflow).toBe('');
  });

  it('releases the lock when Escape closes the menu', () => {
    render(<LandingNavbar />);
    toggle();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.body.style.overflow).toBe('');
  });

  it('releases the lock on unmount, so a closed page is not left unscrollable', () => {
    const { unmount } = render(<LandingNavbar />);
    toggle();
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('');
  });
});

describe('LandingNavbar — links', () => {
  it('renders every nav link in both the desktop and mobile sets', () => {
    const { container } = render(<LandingNavbar />);
    const hrefs = ['#features', '#how', '#faq'];

    for (const href of hrefs) {
      // Counted by href rather than by accessible name: a link's accessible name is
      // its text ("FAQ"), not its target, so a name-based query here would be
      // asserting the wrong thing.
      const matches = container.querySelectorAll(`a[href="${href}"]`);
      expect(matches.length).toBe(2);
    }

    // One of the two is inside the collapsible panel; the other is the desktop set.
    for (const href of hrefs) {
      const [first, second] = Array.from(container.querySelectorAll(`a[href="${href}"]`));
      expect(panel().contains(first!)).toBe(false);
      expect(panel().contains(second!)).toBe(true);
    }
  });

  it('labels the desktop links with their human-readable text', () => {
    render(<LandingNavbar />);
    const expected: Array<[string, string]> = [
      ['#features', 'Features'],
      ['#how', 'How it works'],
      ['#faq', 'FAQ'],
    ];

    for (const [href, label] of expected) {
      const links = screen.getAllByRole('link', { name: label });
      const desktop = links.find(a => a.getAttribute('href') === href);
      expect(desktop).toBeDefined();
    }
  });

  it('offers a sign-in and a sign-up route', () => {
    render(<LandingNavbar />);
    const hrefs = screen.getAllByRole('link').map(a => a.getAttribute('href'));
    expect(hrefs).toContain('/login');
    expect(hrefs).toContain('/signup');
  });

  it('links the wordmark home', () => {
    render(<LandingNavbar />);
    const home = screen
      .getAllByRole('link', { name: /dripl/i })
      .find(a => a.getAttribute('href') === '/');
    expect(home).toBeDefined();
  });
});
