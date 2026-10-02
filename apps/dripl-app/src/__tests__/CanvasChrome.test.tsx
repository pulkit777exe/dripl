import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasControls } from '@/components/canvas/CanvasControls';
import { CanvasToolbar } from '@/components/canvas/CanvasToolbar';
import { useCanvasStore } from '@/lib/store';

vi.mock('@/components/canvas/ExtraToolsDropdown', () => ({
  ExtraToolsDropdown: () => null,
}));

describe('canvas chrome', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      activeTool: 'select',
      toolLocked: false,
      zoom: 1,
      past: [],
      future: [],
      readOnly: false,
    });
  });

  it('exposes the drawing tools as a toolbar with pressed state', () => {
    render(<CanvasToolbar />);

    const toolbar = screen.getByRole('toolbar', { name: 'Drawing tools' });
    const selectTool = screen.getByRole('button', { name: 'Selection tool' });

    expect(toolbar).toHaveAttribute('aria-orientation', 'horizontal');
    expect(selectTool).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Selection tool active')).toBeInTheDocument();
  });

  it('disables mutating tools while the canvas is read-only', () => {
    useCanvasStore.setState({ readOnly: true });
    render(<CanvasToolbar />);

    expect(screen.getByRole('button', { name: 'Rectangle tool' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Selection tool' })).not.toBeDisabled();
  });

  it('exposes zoom and history controls as a named group', () => {
    render(<CanvasControls />);

    expect(screen.getByRole('group', { name: 'Canvas controls' })).toBeInTheDocument();
    expect(screen.getByLabelText('Zoom level')).toHaveTextContent('100%');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
  });
});
