'use client';

import { ActiveTool, useCanvasStore } from '@/lib/store';
import {
  Lock,
  Hand,
  MousePointer2,
  Square,
  Diamond,
  Circle,
  ArrowRight,
  Minus,
  Pencil,
  Type,
  Image,
  Eraser,
} from 'lucide-react';
import { ExtraToolsDropdown } from './ExtraToolsDropdown';

interface Tool {
  id: string;
  icon: React.ComponentType<{ size?: number; className?: string }> | null;
  label: string;
  shortcuts: string[];
  numericShortcut?: string;
}

const tools: Tool[] = [
  { id: 'hand', icon: Hand, label: 'Hand', shortcuts: ['h'] },
  {
    id: 'select',
    icon: MousePointer2,
    label: 'Selection',
    shortcuts: ['v', '1'],
    numericShortcut: '1',
  },
  {
    id: 'rectangle',
    icon: Square,
    label: 'Rectangle',
    shortcuts: ['r', '2'],
    numericShortcut: '2',
  },
  { id: 'diamond', icon: Diamond, label: 'Diamond', shortcuts: ['d', '3'], numericShortcut: '3' },
  { id: 'ellipse', icon: Circle, label: 'Ellipse', shortcuts: ['o', '4'], numericShortcut: '4' },
  { id: 'arrow', icon: ArrowRight, label: 'Arrow', shortcuts: ['a', '5'], numericShortcut: '5' },
  { id: 'line', icon: Minus, label: 'Line', shortcuts: ['l', '6'], numericShortcut: '6' },
  { id: 'freedraw', icon: Pencil, label: 'Freehand', shortcuts: ['p', '7'], numericShortcut: '7' },
  {
    id: 'text',
    icon: Type,
    label: 'Text',
    shortcuts: ['t', '8'],
    numericShortcut: '8',
  },
  {
    id: 'image',
    icon: Image,
    label: 'Insert Image',
    shortcuts: ['9'],
    numericShortcut: '9',
  },
  {
    id: 'eraser',
    icon: Eraser,
    label: 'Eraser',
    shortcuts: ['x', '0'],
    numericShortcut: '0',
  },
];

export function CanvasToolbar() {
  const activeTool = useCanvasStore(state => state.activeTool);
  const toolLocked = useCanvasStore(state => state.toolLocked);
  const setActiveTool = useCanvasStore(state => state.setActiveTool);
  const setToolLocked = useCanvasStore(state => state.setToolLocked);
  const readOnly = useCanvasStore(state => state.readOnly);

  const activeToolLabel = tools.find(tool => tool.id === activeTool)?.label ?? activeTool;

  return (
    <div
      className="canvas-toolbar-shell flex max-w-[calc(100vw-1rem)] items-center gap-0.5 overflow-x-auto px-1.5 py-1.5 sm:px-2 rounded-xl border z-50 pointer-events-auto"
      role="toolbar"
      aria-label="Drawing tools"
      aria-orientation="horizontal"
    >
      <span className="sr-only" aria-live="polite">
        {activeToolLabel} tool active
      </span>

      {/* Lock button */}
      <button
        type="button"
        className="shrink-0 p-1.5 sm:p-2 rounded-md transition-all duration-150"
        style={
          toolLocked
            ? {
                backgroundColor: 'var(--color-tool-active-bg)',
                color: 'var(--color-tool-active-text)',
                boxShadow:
                  '0 0 0 2px var(--color-tool-active-shadow), inset 0 1px 0 rgba(255,255,255,0.1)',
              }
            : { color: 'var(--color-tool-inactive-text)' }
        }
        onClick={() => setToolLocked(!toolLocked)}
        disabled={readOnly}
        aria-label={toolLocked ? 'Unlock current tool' : 'Lock current tool'}
        aria-pressed={toolLocked}
      >
        <div className="t-icon-swap" data-state={toolLocked ? 'b' : 'a'}>
          <span className="t-icon" data-icon="a">
            <Lock size={17} />
          </span>
          <span className="t-icon" data-icon="b">
            <Lock size={17} className="text-[var(--color-tool-active-text)]" />
          </span>
        </div>
      </button>

      {/* Separator */}
      <div
        className="w-px h-5 mx-1 shrink-0"
        style={{ backgroundColor: 'var(--color-toolbar-divider)' }}
        role="separator"
        aria-orientation="vertical"
      />

      {/* Tool buttons */}
      {tools.map(tool => {
        const Icon = tool.icon;
        const isActive = activeTool === tool.id;

        return (
          <button
            type="button"
            key={tool.id}
            id={`tool-btn-${tool.id}`}
            onPointerDown={event => {
              event.preventDefault();
            }}
            onClick={() => setActiveTool(tool.id as ActiveTool)}
            disabled={readOnly && tool.id !== 'hand' && tool.id !== 'select'}
            className="relative shrink-0 p-1.5 sm:p-2 rounded-md transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50"
            style={
              isActive
                ? {
                    backgroundColor: 'var(--color-tool-active-bg)',
                    color: 'var(--color-tool-active-text)',
                    boxShadow:
                      '0 0 0 2px var(--color-tool-active-shadow), inset 0 1px 0 rgba(255,255,255,0.1)',
                  }
                : {
                    color: 'var(--color-tool-inactive-text)',
                  }
            }
            onMouseEnter={e => {
              if (!isActive) {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                  'var(--color-tool-hover-bg)';
              }
            }}
            onMouseLeave={e => {
              if (!isActive) {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
              }
            }}
            title={`${tool.label} [${tool.shortcuts.join(' / ')}]`}
            aria-label={`${tool.label} tool`}
            aria-keyshortcuts={tool.shortcuts.join(' ')}
            aria-pressed={isActive}
          >
            {Icon && <Icon size={18} />}
            {tool.numericShortcut && (
              <span
                className="absolute bottom-[2px] right-[2px] min-w-[10px] text-center text-[9px] font-mono leading-none opacity-75 select-none"
                style={{
                  color: isActive
                    ? 'var(--color-tool-active-text)'
                    : 'var(--color-tool-inactive-text)',
                }}
              >
                {tool.numericShortcut}
              </span>
            )}
          </button>
        );
      })}

      <ExtraToolsDropdown readOnly={readOnly} />
    </div>
  );
}
