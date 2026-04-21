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
      <div 
        className="rounded-2xl shadow-2xl p-6 max-w-lg pointer-events-auto animate-in fade-in zoom-in-95 duration-300"
        style={{ backgroundColor: 'var(--color-panel-bg)', border: '1px solid var(--color-panel-border)' }}
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div 
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: '#E8462A' }}
            >
              <Sparkles size={20} className="text-white" />
            </div>
            <div>
              <h2 className="text-[17px] font-semibold" style={{ color: 'var(--color-panel-text)' }}>Welcome to Dripl</h2>
              <p className="text-[13px]" style={{ color: 'var(--color-panel-label)' }}>Start drawing or try these tools</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md transition-colors hover:bg-[#E8E5DE]"
            style={{ color: 'var(--color-panel-label)' }}
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-4 gap-2 mb-5">
          {tools.map(tool => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.label}
                onClick={() => setActiveTool(tool.tool)}
                className="flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all group"
                style={{ borderColor: 'var(--color-panel-border)', backgroundColor: 'var(--color-panel-btn-bg)' }}
              >
                <div 
                  className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
                  style={{ backgroundColor: 'var(--color-panel-bg)' }}
                >
                  <Icon size={18} className="text-[#6B6860]" />
                </div>
                <div className="text-center">
                  <div className="text-[11px] font-medium" style={{ color: 'var(--color-panel-text)' }}>{tool.label}</div>
                  <div className="text-[10px]" style={{ color: 'var(--color-panel-label)' }}>⌘{tool.shortcut}</div>
                </div>
              </button>
            );
          })}
        </div>

        <div 
          className="rounded-xl p-3.5"
          style={{ backgroundColor: 'var(--color-panel-btn-bg)' }}
        >
          <h3 className="text-[12px] font-semibold mb-2.5" style={{ color: 'var(--color-panel-text)' }}>Quick tips</h3>
          <ul className="space-y-1.5">
            {tips.slice(0, 3).map((tip, i) => (
              <li key={i} className="text-[12px] flex items-center gap-2" style={{ color: 'var(--color-panel-label)' }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#E8462A' }} />
                {tip}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-5 text-center">
          <button
            onClick={onClose}
            className="text-[12px] transition-colors hover:opacity-80"
            style={{ color: 'var(--color-panel-label)' }}
          >
            Press <kbd className="px-1.5 py-0.5 rounded text-[11px] font-mono" style={{ backgroundColor: 'var(--color-panel-bg)', border: '1px solid var(--color-panel-border)' }}>Esc</kbd> to dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
