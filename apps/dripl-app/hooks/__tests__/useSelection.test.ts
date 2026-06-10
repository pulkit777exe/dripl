import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSelection } from '../useSelection';
import type { DriplElement } from '@dripl/common';

vi.mock('@/utils/canvasUtils', () => ({
  isPointInElement: vi.fn(),
}));

const createMockElement = (id: string, overrides?: Partial<DriplElement>): DriplElement =>
  ({
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    angle: 0,
    strokeColor: '#000',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    roughness: 1,
    opacity: 1,
    groupIds: [],
    roundness: null,
    seed: 123,
    version: 1,
    versionNonce: 123,
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    ...overrides,
  } as DriplElement);

describe('useSelection', () => {
  it('initializes with empty selection', () => {
    const { result } = renderHook(() =>
      useSelection({ elements: [], setElements: vi.fn() })
    );
    expect(result.current.selectedIds).toEqual([]);
  });

  it('selects an element', () => {
    const { result } = renderHook(() =>
      useSelection({ elements: [], setElements: vi.fn() })
    );

    act(() => {
      result.current.selectElement('el-1');
    });

    expect(result.current.selectedIds).toEqual(['el-1']);
  });

  it('multi-selects elements', () => {
    const { result } = renderHook(() =>
      useSelection({ elements: [], setElements: vi.fn() })
    );

    act(() => {
      result.current.selectElement('el-1');
    });

    act(() => {
      result.current.selectElement('el-2', true);
    });

    expect(result.current.selectedIds).toEqual(['el-1', 'el-2']);
  });

  it('toggles selection in multi-select mode', () => {
    const { result } = renderHook(() =>
      useSelection({ elements: [], setElements: vi.fn() })
    );

    act(() => {
      result.current.selectElement('el-1');
    });

    act(() => {
      result.current.selectElement('el-1', true);
    });

    expect(result.current.selectedIds).toEqual([]);
  });

  it('deselects all', () => {
    const { result } = renderHook(() =>
      useSelection({ elements: [], setElements: vi.fn() })
    );

    act(() => {
      result.current.selectElement('el-1');
    });

    act(() => {
      result.current.deselectAll();
    });

    expect(result.current.selectedIds).toEqual([]);
  });

  it('deletes selected elements', () => {
    const setElements = vi.fn();
    const elements = [createMockElement('el-1'), createMockElement('el-2')];
    const { result } = renderHook(() =>
      useSelection({ elements, setElements })
    );

    act(() => {
      result.current.selectElement('el-1');
    });

    let deleted: boolean = false;
    act(() => {
      deleted = result.current.deleteSelected() as boolean;
    });

    expect(deleted).toBe(true);
    expect(setElements).toHaveBeenCalled();
    expect(result.current.selectedIds).toEqual([]);
  });

  it('returns false when deleteSelected with no selection', () => {
    const { result } = renderHook(() =>
      useSelection({ elements: [], setElements: vi.fn() })
    );

    let deleted: boolean = false;
    act(() => {
      deleted = result.current.deleteSelected() as boolean;
    });

    expect(deleted).toBe(false);
  });

  it('selects all elements', () => {
    const elements = [createMockElement('el-1'), createMockElement('el-2')];
    const { result } = renderHook(() =>
      useSelection({ elements, setElements: vi.fn() })
    );

    act(() => {
      result.current.selectAll();
    });

    expect(result.current.selectedIds).toEqual(['el-1', 'el-2']);
  });
});
