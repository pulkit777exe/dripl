import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmbedUrlModal } from '@/components/canvas/EmbedUrlModal';
import { NameInputModal } from '@/components/canvas/NameInputModal';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  // Let RTL unmount first: these modals portal into document.body, and
  // clearing it by hand leaves React trying to detach nodes that are gone.
  cleanup();
  vi.useRealTimers();
});

function openModal() {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  const utils = render(<EmbedUrlModal isOpen onClose={onClose} onSubmit={onSubmit} />);
  act(() => {
    vi.advanceTimersToNextFrame();
  });
  return { ...utils, onSubmit, onClose };
}

describe('EmbedUrlModal', () => {
  it('renders nothing until the open animation starts', () => {
    const { container } = render(<EmbedUrlModal isOpen onClose={vi.fn()} onSubmit={vi.fn()} />);
    // Portalled, so the render container stays empty.
    expect(container).toBeEmptyDOMElement();
    expect(screen.getByText('Embed Web Content')).toBeInTheDocument();
    expect(document.querySelector('.t-modal')?.className).not.toContain('is-open');

    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(document.querySelector('.t-modal')?.className).toContain('is-open');
  });

  it('renders nothing while closed', () => {
    const { container } = render(
      <EmbedUrlModal isOpen={false} onClose={vi.fn()} onSubmit={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Embed Web Content')).not.toBeInTheDocument();
  });

  it('submits a valid URL with the optional title', () => {
    const { onSubmit, onClose } = openModal();

    fireEvent.change(screen.getByPlaceholderText('https://example.com'), {
      target: { value: 'https://example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('My Website'), { target: { value: 'Example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Embed' }));

    expect(onSubmit).toHaveBeenCalledWith('https://example.com', 'Example');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('omits an empty title rather than sending an empty string', () => {
    const { onSubmit } = openModal();

    fireEvent.change(screen.getByPlaceholderText('https://example.com'), {
      target: { value: 'https://example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Embed' }));

    expect(onSubmit).toHaveBeenCalledWith('https://example.com', undefined);
  });

  it('refuses an empty URL without submitting', () => {
    const { onSubmit } = openModal();

    fireEvent.click(screen.getByRole('button', { name: 'Embed' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Please enter a URL')).toBeInTheDocument();
  });

  it('blocks a malformed URL at the native validation layer', () => {
    const { onSubmit, onClose } = openModal();

    const input = screen.getByPlaceholderText('https://example.com');
    fireEvent.change(input, { target: { value: 'not a url' } });

    // The field is `type="url"`, so the browser refuses to submit at all:
    // the form's submit handler never runs and the user gets the native
    // validation bubble instead.
    expect(input.closest('form')!.checkValidity()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Embed' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // Consequence: the component's own "Please enter a valid URL" branch is
    // unreachable from the UI. See the report.
    expect(screen.queryByText('Please enter a valid URL')).not.toBeInTheDocument();
  });

  it('would report an invalid URL if the submit handler ran', () => {
    // Direct invocation of the same logic the handler performs, proving the
    // guard itself is correct even though native validation fronts it.
    const { onSubmit, onClose } = openModal();
    fireEvent.change(screen.getByPlaceholderText('https://example.com'), {
      target: { value: 'not a url' },
    });
    fireEvent.submit(screen.getByPlaceholderText('https://example.com').closest('form')!);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Please enter a valid URL')).toBeInTheDocument();
  });

  it('clears the error as soon as the URL is edited', () => {
    openModal();
    fireEvent.click(screen.getByRole('button', { name: 'Embed' }));
    expect(screen.getByText('Please enter a URL')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('https://example.com'), {
      target: { value: 'https://example.com' },
    });
    expect(screen.queryByText('Please enter a URL')).not.toBeInTheDocument();
  });

  it('cancels without submitting', () => {
    const { onSubmit, onClose } = openModal();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('resets the form once the close animation finishes, so reopening is clean', () => {
    const { rerender, onSubmit } = openModal();

    fireEvent.change(screen.getByPlaceholderText('https://example.com'), {
      target: { value: 'https://example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('My Website'), { target: { value: 'Stale' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // Close: the modal unmounts only after the close animation completes.
    act(() => {
      rerender(<EmbedUrlModal isOpen={false} onClose={vi.fn()} onSubmit={onSubmit} />);
    });
    expect(screen.queryByPlaceholderText('https://example.com')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByPlaceholderText('https://example.com')).not.toBeInTheDocument();

    // Reopen: the fields come back empty rather than pre-filled with the
    // values from the previous visit.
    act(() => {
      rerender(<EmbedUrlModal isOpen onClose={vi.fn()} onSubmit={onSubmit} />);
      vi.advanceTimersToNextFrame();
    });

    const url = screen.getByPlaceholderText('https://example.com') as HTMLInputElement;
    expect(url.value).toBe('');
    expect((screen.getByPlaceholderText('My Website') as HTMLInputElement).value).toBe('');
  });
});

describe('NameInputModal', () => {
  it('submits a trimmed name', () => {
    const onSubmit = vi.fn();
    render(<NameInputModal onSubmit={onSubmit} />);
    act(() => {
      vi.advanceTimersToNextFrame();
    });

    const input = screen.getByPlaceholderText('Your Name (e.g. Alice)');
    fireEvent.change(input, { target: { value: '  Ada  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join Room' }));

    expect(onSubmit).toHaveBeenCalledWith('Ada');
  });

  it('keeps the submit button disabled until a name is typed', () => {
    render(<NameInputModal onSubmit={vi.fn()} />);
    act(() => {
      vi.advanceTimersToNextFrame();
    });

    const button = screen.getByRole('button', { name: 'Join Room' });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('Your Name (e.g. Alice)'), {
      target: { value: '   ' },
    });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('Your Name (e.g. Alice)'), {
      target: { value: 'Bo' },
    });
    expect(button).not.toBeDisabled();
  });

  it('portals into the document body rather than the render tree', () => {
    const { container } = render(<NameInputModal onSubmit={vi.fn()} />);
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(container).toBeEmptyDOMElement();
    expect(document.body.querySelector('form')).not.toBeNull();
  });
});
