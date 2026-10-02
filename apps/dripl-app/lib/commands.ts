'use client';

import {
  ArrowRight,
  Circle,
  Diamond,
  Eraser,
  Frame,
  Grid3X3,
  Hand,
  Image,
  Minus,
  Moon,
  MousePointer2,
  Paintbrush,
  Pencil,
  Pipette,
  Redo2,
  Square,
  Sun,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
  Scan,
} from 'lucide-react';
import type { ActiveTool } from '@/lib/store';

/**
 * Command palette model — extracted from `CommandPalette`.
 *
 * Command definitions (labels, keywords, icons, actions) plus the fuzzy
 * matcher and the query filter. The component keeps palette chrome:
 * open/close, grouping, keyboard navigation, and rendering. `perform`
 * closures run against the context passed in, so the table is testable
 * with mock functions.
 */

export type CommandCategory = 'view' | 'tools' | 'actions';

export interface Command {
  id: string;
  label: string;
  keywords: string[];
  category: CommandCategory;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  perform: () => void;
}

export interface CommandContext {
  theme: string;
  setTheme: (theme: 'light' | 'dark') => void;
  zoom: number;
  setZoom: (zoom: number) => void;
  undo: () => void;
  redo: () => void;
  setActiveTool: (tool: ActiveTool) => void;
  gridEnabled: boolean;
  setGridEnabled: (enabled: boolean) => void;
  copyElementStyle: () => boolean;
  pasteElementStyle: () => boolean;
}

export function fuzzyMatch(query: string, text: string): number {
  const normalizedQuery = query.toLowerCase();
  const normalizedText = text.toLowerCase();

  if (normalizedText.includes(normalizedQuery)) {
    return 100 - (normalizedText.length - normalizedQuery.length);
  }

  let score = 0;
  let queryIndex = 0;
  for (let i = 0; i < normalizedText.length && queryIndex < normalizedQuery.length; i++) {
    if (normalizedText[i] === normalizedQuery[queryIndex]) {
      score += i === 0 ? 15 : 5;
      queryIndex++;
    }
  }

  return queryIndex === normalizedQuery.length ? score : 0;
}

/** Score-filter a command list against a raw query (highest first). */
export function filterCommands(commands: Command[], query: string): Command[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return commands;
  }

  const scored = commands
    .map(command => {
      const labelScore = fuzzyMatch(normalizedQuery, command.label);
      const keywordScore = Math.max(...command.keywords.map(kw => fuzzyMatch(normalizedQuery, kw)));
      return {
        command,
        score: Math.max(labelScore, keywordScore),
      };
    })
    .filter(({ score }) => score > 0);

  return scored.sort((a, b) => b.score - a.score).map(({ command }) => command);
}

export function buildCommands(ctx: CommandContext): Command[] {
  const {
    theme,
    setTheme,
    zoom,
    setZoom,
    undo,
    redo,
    setActiveTool,
    gridEnabled,
    setGridEnabled,
    copyElementStyle,
    pasteElementStyle,
  } = ctx;
  return [
    {
      id: 'toggle-theme',
      label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
      keywords: ['theme', 'dark', 'light', 'appearance', 'mode'],
      category: 'view',
      icon: theme === 'dark' ? Sun : Moon,
      perform: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    },
    {
      id: 'zoom-in',
      label: 'Zoom in',
      keywords: ['zoom', 'in', 'increase', 'bigger'],
      category: 'view',
      icon: ZoomIn,
      perform: () => setZoom(Math.min(zoom * 1.2, 20)),
    },
    {
      id: 'zoom-out',
      label: 'Zoom out',
      keywords: ['zoom', 'out', 'decrease', 'smaller'],
      category: 'view',
      icon: ZoomOut,
      perform: () => setZoom(Math.max(zoom / 1.2, 0.1)),
    },
    {
      id: 'reset-zoom',
      label: 'Reset zoom to 100%',
      keywords: ['zoom', 'reset', 'fit', 'default', '100'],
      category: 'view',
      perform: () => setZoom(1),
    },
    {
      id: 'toggle-grid',
      label: gridEnabled ? 'Hide grid' : 'Show grid',
      keywords: ['grid', 'snap', 'alignment', 'toggle'],
      category: 'view',
      icon: Grid3X3,
      perform: () => setGridEnabled(!gridEnabled),
    },
    {
      id: 'undo',
      label: 'Undo',
      keywords: ['undo', 'history', 'back', 'ctrl+z'],
      category: 'actions',
      icon: Undo2,
      perform: () => undo(),
    },
    {
      id: 'redo',
      label: 'Redo',
      keywords: ['redo', 'history', 'forward', 'ctrl+shift+z'],
      category: 'actions',
      icon: Redo2,
      perform: () => redo(),
    },
    {
      id: 'copy-style',
      label: 'Copy style from selection',
      keywords: ['style', 'copy', 'eyedropper', 'format', 'ctrl+shift+c'],
      category: 'actions',
      icon: Pipette,
      perform: () => {
        copyElementStyle();
      },
    },
    {
      id: 'paste-style',
      label: 'Paste style onto selection',
      keywords: ['style', 'paste', 'format', 'apply', 'ctrl+shift+v'],
      category: 'actions',
      icon: Paintbrush,
      perform: () => {
        pasteElementStyle();
      },
    },
    {
      id: 'tool-select',
      label: 'Select tool',
      keywords: ['tool', 'select', 'pointer', 'v'],
      category: 'tools',
      icon: MousePointer2,
      perform: () => setActiveTool('select'),
    },
    {
      id: 'tool-hand',
      label: 'Hand tool (panning)',
      keywords: ['tool', 'hand', 'pan', 'move', 'canvas', 'h'],
      category: 'tools',
      icon: Hand,
      perform: () => setActiveTool('hand'),
    },
    {
      id: 'tool-rectangle',
      label: 'Rectangle tool',
      keywords: ['tool', 'rectangle', 'shape', 'r'],
      category: 'tools',
      icon: Square,
      perform: () => setActiveTool('rectangle'),
    },
    {
      id: 'tool-diamond',
      label: 'Diamond tool',
      keywords: ['tool', 'diamond', 'shape', 'd'],
      category: 'tools',
      icon: Diamond,
      perform: () => setActiveTool('diamond'),
    },
    {
      id: 'tool-ellipse',
      label: 'Ellipse tool',
      keywords: ['tool', 'ellipse', 'circle', 'o'],
      category: 'tools',
      icon: Circle,
      perform: () => setActiveTool('ellipse'),
    },
    {
      id: 'tool-arrow',
      label: 'Arrow tool',
      keywords: ['tool', 'arrow', 'a'],
      category: 'tools',
      icon: ArrowRight,
      perform: () => setActiveTool('arrow'),
    },
    {
      id: 'tool-line',
      label: 'Line tool',
      keywords: ['tool', 'line', 'l'],
      category: 'tools',
      icon: Minus,
      perform: () => setActiveTool('line'),
    },
    {
      id: 'tool-freedraw',
      label: 'Freedraw tool',
      keywords: ['tool', 'freedraw', 'draw', 'pen', 'pencil', 'p'],
      category: 'tools',
      icon: Pencil,
      perform: () => setActiveTool('freedraw'),
    },
    {
      id: 'tool-text',
      label: 'Text tool',
      keywords: ['tool', 'text', 'type', 't'],
      category: 'tools',
      icon: Type,
      perform: () => setActiveTool('text'),
    },
    {
      id: 'tool-image',
      label: 'Image tool',
      keywords: ['tool', 'image', 'picture', 'photo', 'import'],
      category: 'tools',
      icon: Image,
      perform: () => setActiveTool('image'),
    },
    {
      id: 'tool-frame',
      label: 'Frame tool',
      keywords: ['tool', 'frame', 'container', 'group'],
      category: 'tools',
      icon: Frame,
      perform: () => setActiveTool('frame'),
    },
    {
      id: 'tool-embed',
      label: 'Embed tool',
      keywords: ['tool', 'embed', 'web', 'link', 'iframe'],
      category: 'tools',
      icon: Scan,
      perform: () => setActiveTool('embed'),
    },
    {
      id: 'tool-eraser',
      label: 'Eraser tool',
      keywords: ['tool', 'eraser', 'delete', 'remove', 'x'],
      category: 'tools',
      icon: Eraser,
      perform: () => setActiveTool('eraser'),
    },
  ];
}
