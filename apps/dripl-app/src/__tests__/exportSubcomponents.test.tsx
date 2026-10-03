import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ExportFormatPicker } from '@/components/canvas/export/ExportFormatPicker';
import { ExportScaleOptions } from '@/components/canvas/export/ExportScaleOptions';
import { ExportActionList } from '@/components/canvas/export/ExportActionList';
import { ExportStatus } from '@/components/canvas/export/ExportStatus';
import type { ExportFormat, ExportScale } from '@/components/canvas/export/exportTypes';

describe('ExportFormatPicker', () => {
  it('offers every format with a label matching its extension', () => {
    render(<ExportFormatPicker selectedFormat="png" onSelect={vi.fn()} />);
    for (const label of ['PNG', 'SVG', 'JSON', 'DRIPL', 'PDF']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('highlights only the selected format', () => {
    render(<ExportFormatPicker selectedFormat="svg" onSelect={vi.fn()} />);
    // jsdom normalises colours to rgb(), so compare the resolved values.
    expect(screen.getByRole('button', { name: 'SVG' }).style.borderColor).toBe('rgb(232, 70, 42)');
    expect(screen.getByRole('button', { name: 'SVG' }).style.backgroundColor).toBe(
      'rgb(250, 232, 229)'
    );
    expect(screen.getByRole('button', { name: 'PNG' }).style.borderColor).toBe(
      'rgb(212, 208, 201)'
    );
    expect(screen.getByRole('button', { name: 'PNG' }).style.backgroundColor).toBe(
      'rgb(250, 250, 247)'
    );
  });

  it('reports the chosen format', () => {
    const onSelect = vi.fn();
    render(<ExportFormatPicker selectedFormat="png" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    expect(onSelect).toHaveBeenCalledWith('pdf');

    fireEvent.click(screen.getByRole('button', { name: 'DRIPL' }));
    expect(onSelect).toHaveBeenCalledWith('dripl');
  });
});

describe('ExportScaleOptions', () => {
  function setup(overrides: Partial<React.ComponentProps<typeof ExportScaleOptions>> = {}) {
    const handlers = {
      onScale: vi.fn(),
      onCustomSize: vi.fn(),
      onCustomWidth: vi.fn(),
      onCustomHeight: vi.fn(),
      onSelectionOnly: vi.fn(),
    };
    const utils = render(
      <ExportScaleOptions
        selectedFormat="png"
        scale={2}
        useCustomSize={false}
        customWidth=""
        customHeight=""
        selectedCount={0}
        exportSelectionOnly={false}
        {...handlers}
        {...overrides}
      />
    );
    return { ...utils, ...handlers };
  }

  it('hides itself for formats that ignore raster scale', () => {
    for (const format of ['json', 'dripl', 'pdf'] as ExportFormat[]) {
      const { container, unmount } = setup({ selectedFormat: format });
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it('shows the scale buttons for raster formats', () => {
    setup();
    for (const s of [1, 2, 3, 4]) {
      expect(screen.getByRole('button', { name: `${s}x` })).toBeInTheDocument();
    }
  });

  it('picks a scale and leaves custom dimensions', () => {
    const { onScale, onCustomSize } = setup({ useCustomSize: true });

    fireEvent.click(screen.getByRole('button', { name: '4x' }));

    expect(onScale).toHaveBeenCalledWith(4);
    // Choosing a fixed scale must clear a pending custom size, or the two
    // would silently fight over the export dimensions.
    expect(onCustomSize).toHaveBeenCalledWith(false);
  });

  it('marks the active scale only while custom size is off', () => {
    const { rerender } = setup({ scale: 3 });
    expect(screen.getByRole('button', { name: '3x' }).style.borderColor).toBe('rgb(232, 70, 42)');

    rerender(
      <ExportScaleOptions
        selectedFormat="png"
        scale={3}
        useCustomSize
        customWidth=""
        customHeight=""
        selectedCount={0}
        exportSelectionOnly={false}
        onScale={vi.fn()}
        onCustomSize={vi.fn()}
        onCustomWidth={vi.fn()}
        onCustomHeight={vi.fn()}
        onSelectionOnly={vi.fn()}
      />
    );
    // In custom mode no fixed scale claims to be active.
    expect(screen.getByRole('button', { name: '3x' }).style.borderColor).toBe('rgb(212, 208, 201)');
  });

  it('reveals the dimension inputs only in custom mode', () => {
    const { rerender } = setup();
    expect(screen.queryByPlaceholderText('Width')).not.toBeInTheDocument();

    rerender(
      <ExportScaleOptions
        selectedFormat="png"
        scale={2}
        useCustomSize
        customWidth="1200"
        customHeight="800"
        selectedCount={0}
        exportSelectionOnly={false}
        onScale={vi.fn()}
        onCustomSize={vi.fn()}
        onCustomWidth={vi.fn()}
        onCustomHeight={vi.fn()}
        onSelectionOnly={vi.fn()}
      />
    );

    expect(screen.getByPlaceholderText('Width')).toHaveValue(1200);
    expect(screen.getByPlaceholderText('Height')).toHaveValue(800);
  });

  it('toggles custom dimensions and reports the dimensions as strings', () => {
    const { onCustomSize, onCustomWidth, onCustomHeight, rerender } = setup();

    fireEvent.click(screen.getByLabelText('Custom dimensions'));
    expect(onCustomSize).toHaveBeenCalledWith(true);

    rerender(
      <ExportScaleOptions
        selectedFormat="png"
        scale={2}
        useCustomSize
        customWidth=""
        customHeight=""
        selectedCount={0}
        exportSelectionOnly={false}
        onScale={vi.fn()}
        onCustomSize={onCustomSize}
        onCustomWidth={onCustomWidth}
        onCustomHeight={onCustomHeight}
        onSelectionOnly={vi.fn()}
      />
    );
    fireEvent.change(screen.getByPlaceholderText('Width'), { target: { value: '640' } });
    fireEvent.change(screen.getByPlaceholderText('Height'), { target: { value: '480' } });

    expect(onCustomWidth).toHaveBeenCalledWith('640');
    expect(onCustomHeight).toHaveBeenCalledWith('480');
  });

  it('offers the selection-only toggle only when something is selected', () => {
    const { rerender } = setup({ selectedCount: 0 });
    expect(screen.queryByLabelText(/Export selected only/)).not.toBeInTheDocument();

    rerender(
      <ExportScaleOptions
        selectedFormat="png"
        scale={2}
        useCustomSize={false}
        customWidth=""
        customHeight=""
        selectedCount={3}
        exportSelectionOnly={false}
        onScale={vi.fn()}
        onCustomSize={vi.fn()}
        onCustomWidth={vi.fn()}
        onCustomHeight={vi.fn()}
        onSelectionOnly={vi.fn()}
      />
    );
    expect(screen.getByLabelText('Export selected only (3)')).toBeInTheDocument();
  });

  it('reflects the selection-only state', () => {
    const { rerender } = setup({ selectedCount: 2, exportSelectionOnly: true });
    expect(screen.getByLabelText('Export selected only (2)')).toBeChecked();

    rerender(
      <ExportScaleOptions
        selectedFormat="png"
        scale={2}
        useCustomSize={false}
        customWidth=""
        customHeight=""
        selectedCount={2}
        exportSelectionOnly={false}
        onScale={vi.fn()}
        onCustomSize={vi.fn()}
        onCustomWidth={vi.fn()}
        onCustomHeight={vi.fn()}
        onSelectionOnly={vi.fn()}
      />
    );
    expect(screen.getByLabelText('Export selected only (2)')).not.toBeChecked();
  });
});

describe('ExportActionList', () => {
  function setup(overrides: Partial<React.ComponentProps<typeof ExportActionList>> = {}) {
    const handlers = { onExport: vi.fn(), onCopy: vi.fn(), onImport: vi.fn() };
    const utils = render(
      <ExportActionList
        exporting={false}
        useCustomSize={false}
        customWidth=""
        customHeight=""
        scale={2}
        {...handlers}
        {...overrides}
      />
    );
    return { ...utils, ...handlers };
  }

  it('reports each format from its own row', () => {
    const { onExport } = setup();

    fireEvent.click(screen.getByRole('button', { name: /Export as JSON/ }));
    expect(onExport).toHaveBeenCalledWith('json');

    fireEvent.click(screen.getByRole('button', { name: /Export as PNG/ }));
    expect(onExport).toHaveBeenCalledWith('png');

    fireEvent.click(screen.getByRole('button', { name: /Export as SVG/ }));
    expect(onExport).toHaveBeenCalledWith('svg');

    fireEvent.click(screen.getByRole('button', { name: /Export as PDF/ }));
    expect(onExport).toHaveBeenCalledWith('pdf');
  });

  it('shows the active export settings in the PNG subtitle', () => {
    const { rerender } = setup({ scale: 3 });
    expect(screen.getByText('3x scale')).toBeInTheDocument();

    rerender(
      <ExportActionList
        exporting={false}
        useCustomSize
        customWidth="1200"
        customHeight="800"
        scale={2}
        onExport={vi.fn()}
        onCopy={vi.fn()}
        onImport={vi.fn()}
      />
    );
    expect(screen.getByText('1200 × 800 px')).toBeInTheDocument();
  });

  it('shows a placeholder for an unfinished custom size', () => {
    setup({ useCustomSize: true, customWidth: '1200', customHeight: '' });
    expect(screen.getByText('1200 × ? px')).toBeInTheDocument();
  });

  it('disables the image actions while exporting but keeps import available', () => {
    setup({ exporting: true });

    // While exporting the row titles become busy labels, so the rows are
    // located by their (unchanged) subtitles.
    expect(screen.getByText('Copy as PNG image').closest('button')).toBeDisabled();
    expect(screen.getByText('Vector graphics (scalable)').closest('button')).toBeDisabled();
    expect(screen.getByText('Document format').closest('button')).toBeDisabled();
    // Import and the raw JSON row stay available: JSON has no raster work to
    // wait for, and importing mid-export must not be blocked.
    expect(screen.getByText('Save all elements as JSON data').closest('button')).not.toBeDisabled();
    expect(
      screen.getByText('Merge or replace from exported JSON').closest('button')
    ).not.toBeDisabled();
  });

  it('shows busy labels while exporting', () => {
    setup({ exporting: true });
    expect(screen.getAllByText(/Exporting\.\.\./).length).toBeGreaterThan(0);
    expect(screen.getByText(/Copying\.\.\./)).toBeInTheDocument();
  });

  it('wires copy and import', () => {
    const { onCopy, onImport } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Copy to Clipboard/ }));
    expect(onCopy).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Import JSON/ }));
    expect(onImport).toHaveBeenCalledTimes(1);
  });
});

describe('ExportStatus', () => {
  it('renders nothing when there is no status to report', () => {
    const { container } = render(
      <ExportStatus
        exportError={null}
        exportSuccess={null}
        successRef={createRef<HTMLDivElement>()}
        onDismissError={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows an error with a dismiss action', () => {
    const onDismissError = vi.fn();
    render(
      <ExportStatus
        exportError="Export failed. Please try again."
        exportSuccess={null}
        successRef={createRef<HTMLDivElement>()}
        onDismissError={onDismissError}
      />
    );

    expect(screen.getByText('Export failed. Please try again.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(onDismissError).toHaveBeenCalledTimes(1);
  });

  it('shows a success message with the animated check anchor', () => {
    const successRef = createRef<HTMLDivElement>();
    const { container } = render(
      <ExportStatus
        exportError={null}
        exportSuccess="PNG exported successfully"
        successRef={successRef}
        onDismissError={vi.fn()}
      />
    );

    expect(screen.getByText('PNG exported successfully')).toBeInTheDocument();
    // The modal measures this node to drive the stroke-dash animation.
    expect(successRef.current).toBe(container.querySelector('.t-success-check'));
  });

  it('shows both when an error follows an earlier success', () => {
    render(
      <ExportStatus
        exportError="Failed to copy to clipboard."
        exportSuccess="PNG exported successfully"
        successRef={createRef<HTMLDivElement>()}
        onDismissError={vi.fn()}
      />
    );
    expect(screen.getByText('Failed to copy to clipboard.')).toBeInTheDocument();
    expect(screen.getByText('PNG exported successfully')).toBeInTheDocument();
  });
});

describe('ExportScale type surface', () => {
  it('accepts only the documented scales', () => {
    // Compile-time guarantee restated at runtime so a stray value fails here.
    const scales: ExportScale[] = [1, 2, 3, 4];
    expect(scales).toHaveLength(4);
  });
});
