'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Search, Layers, Square, Undo2 } from 'lucide-react';

import { useTheme } from '@/hooks/useTheme';
import { useCanvasStore } from '@/lib/store';
import { useStyleTransfer } from '@/hooks/canvas/useStyleTransfer';
import { buildCommands, filterCommands, type Command, type CommandCategory } from '@/lib/commands';

export function CommandPalette() {
  const { theme, setTheme } = useTheme();

  const zoom = useCanvasStore(state => state.zoom);
  const setZoom = useCanvasStore(state => state.setZoom);
  const undo = useCanvasStore(state => state.undo);
  const redo = useCanvasStore(state => state.redo);
  const setActiveTool = useCanvasStore(state => state.setActiveTool);
  const gridEnabled = useCanvasStore(state => state.gridEnabled);
  const setGridEnabled = useCanvasStore(state => state.setGridEnabled);
  const { copyElementStyle, pasteElementStyle } = useStyleTransfer();

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

  const commands = useMemo(
    () =>
      buildCommands({
        // Matches the historical default: an unresolved theme behaves as light.
        theme: theme ?? 'light',
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
      }),
    [
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
    ]
  );

  const filteredCommands = useMemo(() => filterCommands(commands, query), [commands, query]);

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
        className="w-full max-w-md rounded-xl shadow-lg pointer-events-auto overflow-hidden"
        style={{
          backgroundColor: 'var(--color-card)',
          border: '1px solid var(--color-border)',
        }}
        onKeyDown={handleKeyDown}
      >
        <div
          className="flex items-center gap-2 px-3 py-3"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <Search className="h-4 w-4 text-[#6B6860]" />
          <input
            autoFocus
            className="flex-1 bg-transparent outline-none text-sm text-[#1A1917] placeholder:text-[#9B9890]"
            placeholder="Search commands..."
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
          <span className="text-[10px] text-[#6B6860] bg-[#E8E5DE] px-1.5 py-0.5 rounded">ESC</span>
        </div>

        <div className="max-h-80 overflow-y-auto py-1">
          {filteredCommands.length === 0 ? (
            <div className="px-3 py-8 text-sm text-[#6B6860] text-center">
              No commands found for &apos;{query}&apos;
            </div>
          ) : (
            (['view', 'tools', 'actions'] as CommandCategory[]).map(category => {
              const cmds = groupedCommands[category];
              if (cmds.length === 0) return null;

              const CategoryIcon = getCategoryIcon(category);

              return (
                <div key={category}>
                  <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-medium text-[#6B6860] uppercase tracking-wider bg-[#F0EDE6]">
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
                            ? 'bg-[#FAE8E5] text-[#E8462A]'
                            : 'text-[#1A1917] hover:bg-[#FAE8E5] hover:text-[#1A1917]'
                        }`}
                        onClick={() => {
                          command.perform();
                          setIsOpen(false);
                          setQuery('');
                        }}
                        onMouseEnter={() => setSelectedIndex(itemIndex)}
                      >
                        {Icon && <Icon size={16} className="text-[#6B6860]" />}
                        <span className="flex-1 text-left">{command.label}</span>
                        {selectedIndex === itemIndex && (
                          <span className="text-[10px] text-[#6B6860]">↵</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div
          className="flex justify-between items-center px-3 py-2 text-[11px] text-[#6B6860] bg-[#F0EDE6]"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-[#E8E5DE] rounded text-[10px]">↑↓</kbd> navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-[#E8E5DE] rounded text-[10px]">↵</kbd> select
            </span>
          </div>
          <span>Ctrl/Cmd + K</span>
        </div>
      </div>
    </div>
  );
}
