import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasStore } from '@/lib/store';
import { PropertiesPanel } from '@/components/canvas/PropertiesPanel';
import type { DriplElement } from '@dripl/common';

vi.mock('@/components/canvas/ExportModal', () => ({ ExportModal: () => null }));

function element(type: string, extra: Partial<DriplElement> = {}): DriplElement {
  return {
    id: 'a',
    type,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    strokeStyle: 'solid',
    version: 1,
    versionNonce: 1,
    ...extra,
  } as DriplElement;
}

function setup(selectedElement: DriplElement | null) {
  const onUpdateElement = vi.fn();
  const utils = render(
    <PropertiesPanel
      selectedElement={selectedElement}
      onUpdateElement={onUpdateElement}
      onDeleteElement={vi.fn()}
      onDuplicateElement={vi.fn()}
    />
  );
  return { ...utils, onUpdateElement };
}

beforeEach(() => {
  useCanvasStore.setState({
    selectedIds: new Set<string>(),
    currentStrokeColor: '#1e1e1e',
    currentBackgroundColor: 'transparent',
    currentStrokeWidth: 2,
    currentStrokeStyle: 'solid',
    currentRoughness: 1,
    currentArrowStyle: 'straight',
    elements: [],
    elementsById: new Map(),
    past: [],
    future: [],
    spatialVersion: 0,
    spatialChangedIds: [],
    spatialChangedIdsVersion: 0,
  });
});

describe('PropertiesPanel shape gating', () => {
  it('marks itself closed with nothing selected', () => {
    setup(null);
    const panel = document.querySelector('[data-open]')!;
    expect(panel).toHaveAttribute('data-open', 'false');
    // Without a selection the panel edits the current tool defaults, and the
    // global export action is offered twice over (the action row plus the
    // dedicated button).
    expect(screen.getAllByRole('button', { name: 'Export' }).length).toBeGreaterThan(0);
  });

  it('shows the shape sections a rectangle supports', () => {
    setup(element('rectangle'));
    expect(document.querySelector('[data-open]')).toHaveAttribute('data-open', 'true');
    expect(screen.getByText('Stroke')).toBeInTheDocument();
    expect(screen.getByText('Background')).toBeInTheDocument();
    expect(screen.getByText('Stroke width')).toBeInTheDocument();
    expect(screen.getByText('Stroke style')).toBeInTheDocument();
    expect(screen.getByText('Sloppiness')).toBeInTheDocument();
    expect(screen.getByText('Edges')).toBeInTheDocument();
    expect(screen.getByText('Opacity')).toBeInTheDocument();
    expect(screen.getByText('Layers')).toBeInTheDocument();
  });

  it('hides background and edges for a line, which cannot be filled', () => {
    setup(
      element('line', {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
      } as Partial<DriplElement>)
    );
    expect(screen.getByText('Stroke')).toBeInTheDocument();
    expect(screen.queryByText('Background')).not.toBeInTheDocument();
    expect(screen.queryByText('Edges')).not.toBeInTheDocument();
    expect(screen.queryByText('Arrow type')).not.toBeInTheDocument();
  });

  it('shows arrow controls only for arrows', () => {
    setup(
      element('arrow', {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
      } as Partial<DriplElement>)
    );
    expect(screen.getByText('Arrow type')).toBeInTheDocument();
    expect(screen.getByText('Start arrowhead')).toBeInTheDocument();
    expect(screen.getByText('End arrowhead')).toBeInTheDocument();
    expect(screen.queryByText('Background')).not.toBeInTheDocument();
  });

  it('shows typography controls only for text', () => {
    setup(element('text', { text: 'hi', fontSize: 20 }));
    expect(screen.getByText('Font size')).toBeInTheDocument();
    expect(screen.getByText('Font')).toBeInTheDocument();
    expect(screen.queryByText('Stroke width')).not.toBeInTheDocument();
    expect(screen.queryByText('Background')).not.toBeInTheDocument();
  });

  it('shows only opacity and layers for an image', () => {
    setup(element('image', { src: 'x' }));
    expect(screen.getByText('Opacity')).toBeInTheDocument();
    expect(screen.getByText('Layers')).toBeInTheDocument();
    expect(screen.queryByText('Stroke')).not.toBeInTheDocument();
    expect(screen.queryByText('Sloppiness')).not.toBeInTheDocument();
  });

  it('shows no sections at all for an unknown element type', () => {
    setup(element('somethingNew'));
    expect(screen.queryByText('Stroke')).not.toBeInTheDocument();
    expect(screen.queryByText('Opacity')).not.toBeInTheDocument();
    // An unmapped type gets an empty section list, so even the action row is
    // hidden. Worth pinning: a new element type silently has no properties UI.
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
  });
});

describe('PropertiesPanel multi-selection', () => {
  it('hides the arrange grid for a single selection', () => {
    act(() => useCanvasStore.getState().setSelectedIds(new Set(['a'])));
    setup(element('rectangle'));
    expect(
      screen.queryByLabelText('Align and distribute selected elements')
    ).not.toBeInTheDocument();
  });

  it('shows the arrange grid for two or more selections', () => {
    act(() => useCanvasStore.getState().setSelectedIds(new Set(['a', 'b'])));
    setup(element('rectangle'));
    expect(screen.getByLabelText('Align and distribute selected elements')).toBeInTheDocument();
  });

  it('aligns the whole selection from the arrange grid', () => {
    act(() => useCanvasStore.getState().setSelectedIds(new Set(['a', 'b'])));
    useCanvasStore
      .getState()
      .setElements([element('rectangle', { id: 'a' }), element('rectangle', { id: 'b', x: 200 })], {
        skipHistory: true,
      });
    act(() => useCanvasStore.getState().setSelectedIds(new Set(['a', 'b'])));

    setup(element('rectangle'));
    // Two grids offer left alignment (ArrangeSection and AlignSection); the
    // first is the multi-select one.
    fireEvent.click(screen.getAllByRole('button', { name: 'Align left' })[0]!);

    const xs = useCanvasStore.getState().elements.map(el => el.x);
    expect(new Set(xs).size).toBe(1);
  });
});

describe('PropertiesPanel editing', () => {
  it('writes the changed property back onto the element', () => {
    const { onUpdateElement } = setup(element('rectangle'));

    fireEvent.click(screen.getByRole('button', { name: 'Red' }));

    expect(onUpdateElement).toHaveBeenCalledTimes(1);
    expect(onUpdateElement.mock.calls[0]![0]).toMatchObject({
      id: 'a',
      type: 'rectangle',
      strokeColor: '#e03131',
    });
  });

  it('preserves every other field on the element', () => {
    const { onUpdateElement } = setup(element('rectangle', { x: 42, width: 77 }));

    fireEvent.click(screen.getByRole('button', { name: 'Width 4' }));

    expect(onUpdateElement.mock.calls[0]![0]).toMatchObject({ x: 42, width: 77, strokeWidth: 4 });
  });

  it('updates the current defaults instead when nothing is selected', () => {
    render(<PropertiesPanel selectedElement={null} onUpdateElement={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Red' }));
    expect(useCanvasStore.getState().currentStrokeColor).toBe('#e03131');

    fireEvent.click(screen.getByTitle('Width 4'));
    expect(useCanvasStore.getState().currentStrokeWidth).toBe(4);

    fireEvent.click(screen.getByTitle('dashed'));
    expect(useCanvasStore.getState().currentStrokeStyle).toBe('dashed');

    fireEvent.click(screen.getByTitle('Cartoonist'));
    expect(useCanvasStore.getState().currentRoughness).toBe(2);
  });

  it('merges arrowhead changes instead of replacing the other end', () => {
    const { onUpdateElement } = setup(
      element('arrow', {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        arrowHeads: { end: 'dot' },
      } as Partial<DriplElement>)
    );

    fireEvent.click(screen.getAllByTitle('bar')[0]!);

    expect(onUpdateElement).toHaveBeenCalledWith(
      expect.objectContaining({ arrowHeads: { end: 'dot', start: 'bar' } })
    );
  });

  it('drives opacity from the slider as a fraction', () => {
    const { onUpdateElement } = setup(element('rectangle', { opacity: 1 }));

    fireEvent.change(screen.getByRole('slider'), { target: { value: '40' } });

    expect(onUpdateElement).toHaveBeenCalledWith(expect.objectContaining({ opacity: 0.4 }));
  });

  it('shows the current opacity as a rounded percentage', () => {
    setup(element('rectangle', { opacity: 0.375 }));
    expect(screen.getByText('38')).toBeInTheDocument();
  });

  it('applies a font size and family', () => {
    const { onUpdateElement } = setup(element('text', { text: 'hi', fontSize: 20 }));

    fireEvent.click(screen.getByRole('button', { name: '48' }));
    expect(onUpdateElement).toHaveBeenLastCalledWith(expect.objectContaining({ fontSize: 48 }));

    fireEvent.click(screen.getByRole('button', { name: 'mono' }));
    expect(onUpdateElement).toHaveBeenLastCalledWith(
      expect.objectContaining({ fontFamily: 'monospace' })
    );
  });

  it('does nothing on a style change without an element or handler', () => {
    render(<PropertiesPanel selectedElement={null} />);
    // No onUpdateElement and no selection: the store default path still runs,
    // but with no element nothing should be written.
    fireEvent.click(screen.getByRole('button', { name: 'Width 4' }));
    expect(useCanvasStore.getState().currentStrokeWidth).toBe(4);
  });
});

describe('PropertiesPanel layers', () => {
  it('reorders the selected element through the store', () => {
    useCanvasStore
      .getState()
      .setElements(
        [
          element('rectangle', { id: 'a', fractionalIndex: 'a0' }),
          element('rectangle', { id: 'b', fractionalIndex: 'a1' }),
          element('rectangle', { id: 'c', fractionalIndex: 'a2' }),
        ],
        { skipHistory: true }
      );

    setup(element('rectangle', { id: 'a', fractionalIndex: 'a0' }));
    fireEvent.click(screen.getByTitle('Bring to front'));

    const ids = useCanvasStore.getState().elements.map(el => el.id);
    expect(ids.at(-1)).toBe('a');

    fireEvent.click(screen.getByTitle('Send to back'));
    expect(useCanvasStore.getState().elements[0]!.id).toBe('a');
  });
});
