import { describe, expect, it, vi } from 'vitest';
import { buildCommands, type Command, type CommandContext } from '@/lib/commands';
import type { ActiveTool } from '@/lib/store';

/**
 * Every `perform` closure in the command table.
 *
 * `commands.test.ts` exercises a sample of the table (rectangle, undo, copy-style,
 * toggle-grid) so the wiring is known to work in general. What it cannot show is
 * whether *each* row points at the action its own id and label advertise: fourteen
 * `perform` bodies are one call long each, so a row that sets the wrong tool, or the
 * wrong zoom, is invisible unless that exact row is invoked.
 *
 * Expectations are derived from the row id rather than typed per row, so a mutation
 * that swaps two rows' arguments is still caught: `tool-diamond` -> `ellipse` moves a
 * call away from the id that authorised it.
 */

/** A context whose callables are all distinguishable, so an argument mix-up shows. */
function context(over: Partial<CommandContext> = {}): CommandContext {
  return {
    theme: 'light',
    setTheme: vi.fn<(theme: 'light' | 'dark') => void>(),
    zoom: 1,
    setZoom: vi.fn<(zoom: number) => void>(),
    undo: vi.fn<() => void>(),
    redo: vi.fn<() => void>(),
    setActiveTool: vi.fn<(tool: ActiveTool) => void>(),
    gridEnabled: false,
    setGridEnabled: vi.fn<(enabled: boolean) => void>(),
    copyElementStyle: vi.fn<() => boolean>(),
    pasteElementStyle: vi.fn<() => boolean>(),
    ...over,
  };
}

const byId = (ctx: CommandContext): Map<string, Command> =>
  new Map(buildCommands(ctx).map(command => [command.id, command] as const));

/** Run a row by id and fail loudly if the id is absent, so a rename cannot pass silently. */
function perform(ctx: CommandContext, id: string): void {
  const command = byId(ctx).get(id);
  if (!command) throw new Error(`no command with id ${id}`);
  command.perform();
}

/** The tool each `tool-*` row is expected to activate, taken from its own id. */
const toolRows = [
  ['tool-select', 'select'],
  ['tool-hand', 'hand'],
  ['tool-rectangle', 'rectangle'],
  ['tool-diamond', 'diamond'],
  ['tool-ellipse', 'ellipse'],
  ['tool-arrow', 'arrow'],
  ['tool-line', 'line'],
  ['tool-freedraw', 'freedraw'],
  ['tool-text', 'text'],
  ['tool-image', 'image'],
  ['tool-frame', 'frame'],
  ['tool-embed', 'embed'],
  ['tool-eraser', 'eraser'],
] as const;

describe('buildCommands — tool rows activate their own tool', () => {
  it.each(toolRows)('%s -> setActiveTool(%s)', (id, tool) => {
    const ctx = context();
    perform(ctx, id);
    // Exactly one call, with the tool the row's id names and nothing else.
    expect(ctx.setActiveTool).toHaveBeenCalledTimes(1);
    expect(ctx.setActiveTool).toHaveBeenCalledWith(tool);
  });

  it('covers every tool the store can hold, so no row is left untested', () => {
    // Every `ActiveTool` except `laser`, which the table has no row for. Asserting the
    // row set against the id list keeps this from becoming a tautology if a row is added.
    const tools = new Set(toolRows.map(([, tool]) => tool));
    expect(tools.size).toBe(toolRows.length);
    expect(
      buildCommands(context())
        .filter(c => c.category === 'tools')
        .map(c => c.id)
    ).toEqual(toolRows.map(([id]) => id));
  });
});

describe('buildCommands — zoom rows', () => {
  it('zoom-in multiplies by 1.2 and clamps at 20', () => {
    const ctx = context({ zoom: 2 });
    perform(ctx, 'zoom-in');
    expect(ctx.setZoom).toHaveBeenCalledTimes(1);
    expect(ctx.setZoom).toHaveBeenCalledWith(2 * 1.2);
  });

  it('zoom-in clamps instead of exceeding the ceiling', () => {
    const ctx = context({ zoom: 19 });
    perform(ctx, 'zoom-in');
    // 19 * 1.2 = 22.8, above the cap. If the clamp were dropped the call would be 22.8,
    // which is what makes this an assertion about the cap and not about the multiply.
    expect(ctx.setZoom).toHaveBeenCalledWith(20);
  });

  it('zoom-out divides by 1.2', () => {
    const ctx = context({ zoom: 6 });
    perform(ctx, 'zoom-out');
    expect(ctx.setZoom).toHaveBeenCalledTimes(1);
    expect(ctx.setZoom).toHaveBeenCalledWith(6 / 1.2);
  });

  it('zoom-out clamps instead of falling below the floor', () => {
    const ctx = context({ zoom: 0.11 });
    perform(ctx, 'zoom-out');
    // 0.11 / 1.2 is below 0.1, so without the clamp the call would be ~0.0917.
    expect(ctx.setZoom).toHaveBeenCalledWith(0.1);
  });

  it('reset-zoom sets exactly 1 regardless of the current zoom', () => {
    const ctx = context({ zoom: 13.5 });
    perform(ctx, 'reset-zoom');
    expect(ctx.setZoom).toHaveBeenCalledTimes(1);
    expect(ctx.setZoom).toHaveBeenCalledWith(1);
  });
});

describe('buildCommands — history and style rows', () => {
  it('undo calls undo only', () => {
    const ctx = context();
    perform(ctx, 'undo');
    expect(ctx.undo).toHaveBeenCalledTimes(1);
    expect(ctx.redo).not.toHaveBeenCalled();
  });

  it('redo calls redo only', () => {
    const ctx = context();
    perform(ctx, 'redo');
    expect(ctx.redo).toHaveBeenCalledTimes(1);
    expect(ctx.undo).not.toHaveBeenCalled();
  });

  it('copy-style forwards its boolean result to nothing and still calls copy', () => {
    // The row deliberately discards the return: the palette closes regardless, and the
    // toast comes from the clipboard hook. What matters here is that copy ran once and
    // paste did not.
    const ctx = context();
    perform(ctx, 'copy-style');
    expect(ctx.copyElementStyle).toHaveBeenCalledTimes(1);
    expect(ctx.pasteElementStyle).not.toHaveBeenCalled();
  });

  it('paste-style calls paste and not copy', () => {
    const ctx = context();
    perform(ctx, 'paste-style');
    expect(ctx.pasteElementStyle).toHaveBeenCalledTimes(1);
    expect(ctx.copyElementStyle).not.toHaveBeenCalled();
  });
});

describe('buildCommands — theme and grid rows read their own context value', () => {
  it('toggle-theme flips light to dark', () => {
    const ctx = context({ theme: 'light' });
    perform(ctx, 'toggle-theme');
    expect(ctx.setTheme).toHaveBeenCalledTimes(1);
    expect(ctx.setTheme).toHaveBeenCalledWith('dark');
  });

  it('toggle-theme flips dark to light', () => {
    const ctx = context({ theme: 'dark' });
    perform(ctx, 'toggle-theme');
    expect(ctx.setTheme).toHaveBeenCalledWith('light');
  });

  it('toggle-grid turns a disabled grid on', () => {
    const ctx = context({ gridEnabled: false });
    perform(ctx, 'toggle-grid');
    expect(ctx.setGridEnabled).toHaveBeenCalledWith(true);
  });

  it('toggle-grid turns an enabled grid off', () => {
    const ctx = context({ gridEnabled: true });
    perform(ctx, 'toggle-grid');
    expect(ctx.setGridEnabled).toHaveBeenCalledWith(false);
  });

  it('performing a toggle twice sends the same argument, because ctx is captured', () => {
    // The rows close over the ctx object as it was when the table was built, and the
    // ctx setters here are inert. So the second call cannot observe the first one's
    // effect: if `perform` instead re-read a live value and toggled, the two calls would
    // differ. Asserted on the full call list so the count cannot hide an extra call.
    const setTheme = vi.fn<(theme: 'light' | 'dark') => void>();
    const setGridEnabled = vi.fn<(enabled: boolean) => void>();
    const ctx = context({ theme: 'light', gridEnabled: false, setTheme, setGridEnabled });
    const table = byId(ctx);
    table.get('toggle-theme')?.perform();
    table.get('toggle-theme')?.perform();
    table.get('toggle-grid')?.perform();
    table.get('toggle-grid')?.perform();
    expect(setTheme.mock.calls).toEqual([['dark'], ['dark']]);
    expect(setGridEnabled.mock.calls).toEqual([[true], [true]]);
  });
});
