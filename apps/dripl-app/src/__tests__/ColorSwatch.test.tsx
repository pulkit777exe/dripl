import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ColorSwatch } from '@/components/canvas/ColorSwatch';

describe('ColorSwatch', () => {
  it('renders with the given color', () => {
    render(<ColorSwatch color="#ff0000" />);
    const button = screen.getByRole('button');
    expect(button).toHaveStyle({ backgroundColor: '#ff0000' });
  });

  it('applies selected styles when isSelected is true', () => {
    render(<ColorSwatch color="#00ff00" isSelected />);
    const button = screen.getByRole('button');
    expect(button).toHaveClass('border-[#a8a5ff]');
  });

  it('applies unselected styles by default', () => {
    render(<ColorSwatch color="#0000ff" />);
    const button = screen.getByRole('button');
    expect(button).toHaveClass('border-gray-600');
  });

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<ColorSwatch color="#ffff00" onClick={onClick} />);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders transparent swatch with checkerboard pattern', () => {
    render(<ColorSwatch color="transparent" />);
    const button = screen.getByRole('button');
    expect(button.querySelector('div')).toBeInTheDocument();
  });

  it('shows selection indicator when selected', () => {
    render(<ColorSwatch color="#ff00ff" isSelected />);
    const indicator = screen.getByRole('button').querySelector('div');
    expect(indicator).toBeInTheDocument();
  });
});
