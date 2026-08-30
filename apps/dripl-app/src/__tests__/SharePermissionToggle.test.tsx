import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SharePermissionToggle } from '@/components/canvas/SharePermissionToggle';

describe('SharePermissionToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with view selected by default and announces it', () => {
    render(<SharePermissionToggle value="view" onChange={() => {}} />);

    const viewRadio = screen.getByRole('radio', { name: /view only/i });
    const editRadio = screen.getByRole('radio', { name: /can edit/i });

    expect(viewRadio).toBeChecked();
    expect(viewRadio).toHaveAttribute('aria-checked', 'true');
    expect(editRadio).not.toBeChecked();
  });

  it('uses the radiogroup role with an accessible label', () => {
    render(<SharePermissionToggle value="view" onChange={() => {}} />);
    expect(screen.getByRole('radiogroup', { name: /who can open this link/i })).toBeInTheDocument();
  });

  it('reflects the current permission value (controlled)', () => {
    const { rerender } = render(<SharePermissionToggle value="view" onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: /view only/i })).toBeChecked();

    rerender(<SharePermissionToggle value="edit" onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: /can edit/i })).toBeChecked();
  });

  it('calls onChange with the new permission when a radio is activated', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SharePermissionToggle value="view" onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: /can edit/i }));

    expect(onChange).toHaveBeenCalledWith('edit');
  });

  it('does not call onChange when the already-selected radio is re-clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SharePermissionToggle value="view" onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: /view only/i }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables both radios when disabled is true', () => {
    render(<SharePermissionToggle value="view" onChange={() => {}} disabled />);
    expect(screen.getByRole('radio', { name: /view only/i })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /can edit/i })).toBeDisabled();
  });

  it('marks the selected radio with a distinct visual style (aria-checked=true on the selected only)', () => {
    render(<SharePermissionToggle value="edit" onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: /view only/i })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: /can edit/i })).toHaveAttribute('aria-checked', 'true');
  });
});
