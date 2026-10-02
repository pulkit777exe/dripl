import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const setActiveTool = vi.fn();
const setPendingEmbed = vi.fn();

vi.mock('@/lib/store', () => ({
  useCanvasStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      setActiveTool,
      activeTool: 'select',
      setPendingEmbed,
    }),
}));

import { ExtraToolsDropdown } from '@/components/canvas/ExtraToolsDropdown';

describe('ExtraToolsDropdown', () => {
  it('exposes the AI generator from a portal menu', () => {
    render(<ExtraToolsDropdown />);
    fireEvent.click(screen.getByRole('button', { name: /frame and library tools/i }));

    expect(screen.getByRole('menu', { name: /more drawing tools/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /text to diagram/i })).toBeInTheDocument();
  });

  it('activates the frame tool from the extended menu', () => {
    render(<ExtraToolsDropdown />);
    fireEvent.click(screen.getByRole('button', { name: /frame and library tools/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /frame tool/i }));

    expect(setActiveTool).toHaveBeenCalledWith('frame');
  });
});
