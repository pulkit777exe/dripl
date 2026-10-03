import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Menu } from '@/components/canvas/Menu';
import { useCanvasStore } from '@/lib/store';

const themeState = vi.hoisted(() => ({ theme: 'light' as string, setTheme: vi.fn() }));

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: themeState.theme, setTheme: themeState.setTheme }),
}));

function setup(overrides: Partial<React.ComponentProps<typeof Menu>> = {}) {
  const handlers = {
    onClose: vi.fn(),
    onOpenCommandPalette: vi.fn(),
    onResetCanvas: vi.fn(),
    onExportImage: vi.fn(),
    onLiveCollaboration: vi.fn(),
    onOpenFile: vi.fn(),
    onSaveToFile: vi.fn(),
    onFindOnCanvas: vi.fn(),
    onOpenHelp: vi.fn(),
    onLanguageChange: vi.fn(),
  };
  const utils = render(<Menu isOpen activeLanguage="en" {...handlers} {...overrides} />);
  return { ...utils, ...handlers };
}

beforeEach(() => {
  themeState.theme = 'light';
  themeState.setTheme.mockClear();
  useCanvasStore.setState({ canvasBackground: null });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('Menu actions', () => {
  it('routes each item to its handler', () => {
    const { onOpenFile, onSaveToFile, onExportImage, onLiveCollaboration } = setup();

    fireEvent.click(screen.getByRole('button', { name: /Open/ }));
    fireEvent.click(screen.getByRole('button', { name: /Save to/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export image/ }));
    fireEvent.click(screen.getByRole('button', { name: /Live collaboration/ }));

    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onSaveToFile).toHaveBeenCalledTimes(1);
    expect(onExportImage).toHaveBeenCalledTimes(1);
    expect(onLiveCollaboration).toHaveBeenCalledTimes(1);
  });

  it('routes the palette, find, help and reset items', () => {
    const { onOpenCommandPalette, onFindOnCanvas, onOpenHelp, onResetCanvas } = setup();

    fireEvent.click(screen.getByRole('button', { name: /Command palette/ }));
    fireEvent.click(screen.getByRole('button', { name: /Find on canvas/ }));
    fireEvent.click(screen.getByRole('button', { name: /Help/ }));
    fireEvent.click(screen.getByRole('button', { name: /Reset the canvas/ }));

    expect(onOpenCommandPalette).toHaveBeenCalledTimes(1);
    expect(onFindOnCanvas).toHaveBeenCalledTimes(1);
    expect(onOpenHelp).toHaveBeenCalledTimes(1);
    expect(onResetCanvas).toHaveBeenCalledTimes(1);
  });

  it('does not close the menu when an item owns its own dismissal', () => {
    const { onClose, onOpenFile } = setup();

    fireEvent.click(screen.getByRole('button', { name: /Open/ }));

    expect(onOpenFile).toHaveBeenCalledTimes(1);
    // The handler is responsible for closing; double-closing would race the
    // item's own navigation.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on a click outside and not on a click inside', () => {
    const { onClose } = setup();
    const outside = document.createElement('div');
    document.body.appendChild(outside);

    fireEvent.mouseDown(screen.getByRole('button', { name: /Open/ }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(outside);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Menu links', () => {
  it('opens external links in a new tab and internal ones in place', () => {
    setup();
    const github = screen.getByRole('link', { name: /GitHub/ });
    expect(github).toHaveAttribute('href', 'https://github.com');
    expect(github).toHaveAttribute('target', '_blank');
    expect(github).toHaveAttribute('rel', 'noopener noreferrer');

    const signup = screen.getByRole('link', { name: /Sign up/ });
    expect(signup).toHaveAttribute('href', '/signup');
    expect(signup).not.toHaveAttribute('target');
  });
});

describe('Menu theme', () => {
  it('offers all three themes and applies the chosen one', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'dark theme' }));
    expect(themeState.setTheme).toHaveBeenCalledWith('dark');
  });

  it('highlights exactly the current theme', () => {
    themeState.theme = 'dark';
    const { rerender, ...rest } = setup();
    expect(screen.getByRole('button', { name: 'dark theme' }).style.backgroundColor).toBe(
      'var(--color-primary)'
    );
    expect(screen.getByRole('button', { name: 'light theme' }).style.backgroundColor).toBe('');

    themeState.theme = 'system';
    act(() => {
      rerender(
        <Menu
          isOpen
          activeLanguage="en"
          onClose={rest.onClose}
          onOpenCommandPalette={rest.onOpenCommandPalette}
          onResetCanvas={rest.onResetCanvas}
          onExportImage={rest.onExportImage}
          onLiveCollaboration={rest.onLiveCollaboration}
          onOpenFile={rest.onOpenFile}
          onSaveToFile={rest.onSaveToFile}
          onFindOnCanvas={rest.onFindOnCanvas}
          onOpenHelp={rest.onOpenHelp}
          onLanguageChange={rest.onLanguageChange}
        />
      );
    });

    expect(screen.getByRole('button', { name: 'system theme' }).style.backgroundColor).toBe(
      'var(--color-primary)'
    );
    expect(screen.getByRole('button', { name: 'dark theme' }).style.backgroundColor).toBe('');
  });
});

describe('Menu canvas background', () => {
  it('applies a preset and marks it pressed', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Canvas background #1C1A17' }));
    expect(useCanvasStore.getState().canvasBackground).toBe('#1C1A17');
    expect(screen.getByRole('button', { name: 'Canvas background #1C1A17' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('matches a preset case-insensitively so a stored lowercase value still highlights', () => {
    useCanvasStore.setState({ canvasBackground: '#1c1a17' });
    setup();
    expect(screen.getByRole('button', { name: 'Canvas background #1C1A17' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('offers the reset control only once a background is set', () => {
    const { rerender } = setup();
    expect(
      screen.queryByRole('button', { name: 'Reset canvas background to theme default' })
    ).not.toBeInTheDocument();

    act(() => {
      useCanvasStore.setState({ canvasBackground: '#FFFFFF' });
    });

    const reset = screen.getByRole('button', {
      name: 'Reset canvas background to theme default',
    });
    fireEvent.click(reset);
    expect(useCanvasStore.getState().canvasBackground).toBeNull();
    void rerender;
  });

  it('seeds the custom colour input from the theme default when unset', () => {
    themeState.theme = 'dark';
    setup();
    const input = screen.getByLabelText('Custom canvas background') as HTMLInputElement;
    expect(input.value).toBe('#1c1a17');

    fireEvent.change(input, { target: { value: '#123456' } });
    expect(useCanvasStore.getState().canvasBackground).toBe('#123456');
  });
});

describe('Menu language', () => {
  it('reflects and changes the active language', () => {
    const onLanguageChange = vi.fn();
    setup({ onLanguageChange });

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('en');
    expect(screen.getByRole('option', { name: 'Japanese' })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'ja' } });
    expect(onLanguageChange).toHaveBeenCalledWith('ja');
  });

  it('survives the change handler being absent', () => {
    setup({ onLanguageChange: undefined });
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(() => fireEvent.change(select, { target: { value: 'fr' } })).not.toThrow();
  });
});
