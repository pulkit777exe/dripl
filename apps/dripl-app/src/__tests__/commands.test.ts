import { describe, expect, it, vi } from 'vitest';
import { buildCommands, filterCommands, fuzzyMatch, type Command } from '@/lib/commands';

function mockContext() {
  return {
    theme: 'light',
    setTheme: vi.fn(),
    zoom: 1,
    setZoom: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    setActiveTool: vi.fn(),
    gridEnabled: false,
    setGridEnabled: vi.fn(),
    copyElementStyle: vi.fn(),
    pasteElementStyle: vi.fn(),
  };
}

describe('fuzzyMatch', () => {
  it('rewards substring matches by brevity', () => {
    expect(fuzzyMatch('zoom', 'Zoom in')).toBeGreaterThan(fuzzyMatch('zoom', 'Reset zoom to 100%'));
  });

  it('matches subsequences and rejects misses', () => {
    expect(fuzzyMatch('tg', 'Toggle grid')).toBeGreaterThan(0);
    expect(fuzzyMatch('xyz', 'Zoom in')).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(fuzzyMatch('GRID', 'Toggle grid')).toBeGreaterThan(0);
  });
});

describe('filterCommands', () => {
  const commands = buildCommands(mockContext());

  it('returns everything on a blank query', () => {
    expect(filterCommands(commands, '   ')).toBe(commands);
  });

  it('ranks label hits above keyword-only hits', () => {
    const ranked = filterCommands(commands, 'grid');
    expect(ranked[0]?.id).toBe('toggle-grid');
  });

  it('finds tools by shortcut keyword', () => {
    const ids = filterCommands(commands, 'x').map(c => c.id);
    expect(ids).toContain('tool-eraser');
  });

  it('returns empty for nonsense', () => {
    expect(filterCommands(commands, 'zzz-no-match')).toEqual([]);
  });
});

describe('buildCommands', () => {
  it('has unique ids and valid categories', () => {
    const commands = buildCommands(mockContext());
    const ids = commands.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const command of commands) {
      expect(['view', 'tools', 'actions']).toContain(command.category);
      expect(command.label.length).toBeGreaterThan(0);
    }
  });

  it('exposes style clipboard and missing tools', () => {
    const byId = new Map(buildCommands(mockContext()).map(c => [c.id, c] as const));
    expect(byId.has('copy-style')).toBe(true);
    expect(byId.has('paste-style')).toBe(true);
    expect(byId.has('tool-frame')).toBe(true);
    expect(byId.has('tool-embed')).toBe(true);
  });

  it('wires perform to context actions', () => {
    const ctx = mockContext();
    const byId = new Map<string, Command>(buildCommands(ctx).map(c => [c.id, c] as const));
    byId.get('tool-rectangle')?.perform();
    expect(ctx.setActiveTool).toHaveBeenCalledWith('rectangle');
    byId.get('undo')?.perform();
    expect(ctx.undo).toHaveBeenCalled();
    byId.get('copy-style')?.perform();
    expect(ctx.copyElementStyle).toHaveBeenCalled();
    byId.get('toggle-grid')?.perform();
    expect(ctx.setGridEnabled).toHaveBeenCalledWith(true);
  });

  it('labels the theme toggle from the current theme', () => {
    const dark = new Map(
      buildCommands({ ...mockContext(), theme: 'dark' }).map(c => [c.id, c] as const)
    );
    expect(dark.get('toggle-theme')?.label).toBe('Switch to light theme');
  });
});
