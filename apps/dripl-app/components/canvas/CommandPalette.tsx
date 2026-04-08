'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Search,
  Sun,
  Moon,
  ZoomIn,
  ZoomOut,
  Undo2,
  Redo2,
  MousePointer2,
  Hand,
  Square,
  Diamond,
  Circle,
  ArrowRight,
  Minus,
  Pencil,
  Type,
  Image,
  Eraser,
  Layers,
  Grid3X3,
} from 'lucide-react';

import { useTheme } from '@/hooks/useTheme';
import { useCanvasStore } from '@/lib/canvas-store';

type CommandCategory = 'view' | 'tools' | 'actions';

type Command = {
  id: string;
  label: string;
  keywords: string[];
  category: CommandCategory;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  perform: () => void;
};

function fuzzyMatch(query: string, text: string): number {
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

export function CommandPalette() {
  const { theme, setTheme } = useTheme();

  const zoom = useCanvasStore(state => state.zoom);
  const setZoom = useCanvasStore(state => state.setZoom);
  const undo = useCanvasStore(state => state.undo);
  const redo = useCanvasStore(state => state.redo);
  const setActiveTool = useCanvasStore(state => state.setActiveTool);
  const gridEnabled = useCanvasStore(state => state.gridEnabled);
  const setGridEnabled = useCanvasStore(state => state.setGridEnabled);

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsOpen(open => !open);
        return;
      }
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    const onOpenPalette = () => {
      setIsOpen(true);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('dripl:open-command-palette', onOpenPalette);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('dripl:open-command-palette', onOpenPalette);
    };
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const commands: Command[] = useMemo(
    () => [
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
        id: 'tool-eraser',
        label: 'Eraser tool',
        keywords: ['tool', 'eraser', 'delete', 'remove', 'x'],
        category: 'tools',
        icon: Eraser,
        perform: () => setActiveTool('eraser'),
      },
    ],
    [theme, setTheme, zoom, setZoom, undo, redo, setActiveTool, gridEnabled, setGridEnabled]
  );

  const filteredCommands = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return commands;
    }

    const scored = commands
      .map(command => {
        const labelScore = fuzzyMatch(normalizedQuery, command.label);
        const keywordScore = Math.max(
          ...command.keywords.map(kw => fuzzyMatch(normalizedQuery, kw))
        );
        return {
          command,
          score: Math.max(labelScore, keywordScore),
        };
      })
      .filter(({ score }) => score > 0);

    return scored.sort((a, b) => b.score - a.score).map(({ command }) => command);
  }, [commands, query]);

  const groupedCommands = useMemo(() => {
    const groups: Record<CommandCategory, Command[]> = {
      view: [],
      tools: [],
      actions: [],
    };

    filteredCommands.forEach(cmd => {
      groups[cmd.category].push(cmd);
    });

    return groups;
  }, [filteredCommands]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, filteredCommands.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = filteredCommands[selectedIndex];
        if (cmd) {
          cmd.perform();
          setIsOpen(false);
          setQuery('');
        }
      }
    },
    [filteredCommands, selectedIndex]
  );

  const categoryLabels: Record<CommandCategory, string> = {
    view: 'View',
    tools: 'Tools',
    actions: 'Actions',
  };

  const getCategoryIcon = (category: CommandCategory) => {
    switch (category) {
      case 'view':
        return Layers;
      case 'tools':
        return Square;
      case 'actions':
        return Undo2;
    }
  };

  if (!isOpen) {
    return null;
  }

  let currentIndex = 0;

  return (
    <div
      className="fixed inset-0 z-120 flex items-start justify-center pt-24 bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-full max-w-md rounded-xl bg-background shadow-lg border border-border pointer-events-auto overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-2 px-3 py-3 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            className="flex-1 bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground"
            placeholder="Search commands..."
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            ESC
          </span>
        </div>

        <div className="max-h-80 overflow-y-auto py-1">
          {filteredCommands.length === 0 ? (
            <div className="px-3 py-8 text-sm text-muted-foreground text-center">
              No commands found for &apos;{query}&apos;
            </div>
          ) : (
            (['view', 'tools', 'actions'] as CommandCategory[]).map(category => {
              const cmds = groupedCommands[category];
              if (cmds.length === 0) return null;

              const CategoryIcon = getCategoryIcon(category);

              return (
                <div key={category}>
                  <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider bg-muted/50">
                    <CategoryIcon size={12} />
                    {categoryLabels[category]}
                  </div>
                  {cmds.map(command => {
                    const itemIndex = currentIndex++;
                    const Icon = command.icon;

                    return (
                      <button
                        key={command.id}
                        type="button"
                        className={`w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors ${
                          selectedIndex === itemIndex
                            ? 'bg-primary/10 text-primary'
                            : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                        }`}
                        onClick={() => {
                          command.perform();
                          setIsOpen(false);
                          setQuery('');
                        }}
                        onMouseEnter={() => setSelectedIndex(itemIndex)}
                      >
                        {Icon && <Icon size={16} className="text-muted-foreground" />}
                        <span className="flex-1 text-left">{command.label}</span>
                        {selectedIndex === itemIndex && (
                          <span className="text-[10px] text-muted-foreground">↵</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="flex justify-between items-center px-3 py-2 border-t border-border text-[11px] text-muted-foreground bg-muted/30">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">↑↓</kbd> navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">↵</kbd> select
            </span>
          </div>
          <span>Ctrl/Cmd + K</span>
        </div>
      </div>
    </div>
  );
}
