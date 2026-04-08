'use client';

import { useCanvasStore, type ActiveTool } from '@/lib/canvas-store';
import {
  Square,
  Circle,
  Diamond,
  ArrowRight,
  Minus,
  Pencil,
  Type,
  Frame,
  Eraser,
  MousePointer2,
  Hand,
  Sparkles,
} from 'lucide-react';

interface WelcomeScreenProps {
  onClose: () => void;
}

const tools: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  shortcut: string;
  tool: ActiveTool;
}[] = [
  { icon: MousePointer2, label: 'Select', shortcut: 'V', tool: 'select' },
  { icon: Hand, label: 'Pan', shortcut: 'H', tool: 'hand' },
  { icon: Square, label: 'Rectangle', shortcut: 'R', tool: 'rectangle' },
  { icon: Circle, label: 'Ellipse', shortcut: 'O', tool: 'ellipse' },
  { icon: Diamond, label: 'Diamond', shortcut: 'D', tool: 'diamond' },
  { icon: ArrowRight, label: 'Arrow', shortcut: 'A', tool: 'arrow' },
  { icon: Minus, label: 'Line', shortcut: 'L', tool: 'line' },
  { icon: Pencil, label: 'Freehand', shortcut: 'P', tool: 'freedraw' },
  { icon: Type, label: 'Text', shortcut: 'T', tool: 'text' },
  { icon: Frame, label: 'Frame', shortcut: 'F', tool: 'frame' },
  { icon: Eraser, label: 'Eraser', shortcut: 'X', tool: 'eraser' },
];

const tips = [
  'Hold Space to temporarily switch to pan mode',
  'Use Shift to constrain shapes to squares/circles',
  'Ctrl+G to toggle grid snapping',
  'Ctrl+D to duplicate selected elements',
  'Ctrl+Z to undo, Ctrl+Shift+Z to redo',
];

export function WelcomeScreen({ onClose }: WelcomeScreenProps) {
  const elements = useCanvasStore(state => state.elements);
  const setActiveTool = useCanvasStore(state => state.setActiveTool);

  if (elements.length > 0) return null;

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
      <div className="bg-background/95 backdrop-blur-sm border border-border rounded-2xl shadow-2xl p-8 max-w-2xl pointer-events-auto animate-in fade-in zoom-in-95 duration-300">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-linear-to-br from-primary to-primary/60 rounded-xl flex items-center justify-center">
              <Sparkles size={24} className="text-primary-foreground" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-foreground">Welcome to Dripl</h2>
              <p className="text-muted-foreground">Start drawing or try these tools</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-4 gap-2 mb-6">
          {tools.map(tool => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.label}
                onClick={() => setActiveTool(tool.tool)}
                className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border hover:bg-accent hover:border-primary/50 transition-all group"
              >
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <Icon size={20} className="text-muted-foreground group-hover:text-primary" />
                </div>
                <div className="text-center">
                  <div className="text-sm font-medium text-foreground">{tool.label}</div>
                  <div className="text-xs text-muted-foreground">⌘{tool.shortcut}</div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="bg-muted/50 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Quick tips</h3>
          <ul className="space-y-2">
            {tips.slice(0, 3).map((tip, i) => (
              <li key={i} className="text-sm text-muted-foreground flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                {tip}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 text-center">
          <button
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Press <kbd className="px-1.5 py-0.5 rounded bg-muted text-xs">Esc</kbd> to dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
