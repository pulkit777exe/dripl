'use client';

import React from 'react';
import {
  MousePointer2,
  Square,
  Diamond,
  Circle,
  ArrowRight,
  Minus,
  Type,
  Image as ImageIcon,
  Pencil,
  Hand,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SidebarProps {
  activeTool?: string;
  onToolSelect?: (tool: string) => void;
}

export function Sidebar({ activeTool = 'select', onToolSelect }: SidebarProps) {
  const tools = [
    { id: 'select', icon: MousePointer2, label: 'Select' },
    { id: 'hand', icon: Hand, label: 'Pan' },
    { id: 'rectangle', icon: Square, label: 'Rectangle' },
    { id: 'diamond', icon: Diamond, label: 'Diamond' },
    { id: 'ellipse', icon: Circle, label: 'Ellipse' },
    { id: 'arrow', icon: ArrowRight, label: 'Arrow' },
    { id: 'line', icon: Minus, label: 'Line' },
    { id: 'text', icon: Type, label: 'Text' },
    { id: 'image', icon: ImageIcon, label: 'Image' },
    { id: 'freedraw', icon: Pencil, label: 'Draw' },
  ];

  return (
    <aside
      className="fixed left-0 top-0 z-50 flex h-full w-14 flex-col items-center border-r py-4"
      style={{
        backgroundColor: 'var(--color-background)',
        borderColor: 'var(--color-border)',
      }}
    >
      <div className="mb-4">
        <div className="h-8 w-8 rounded bg-[#E8462A]" />
      </div>
      <div className="flex flex-col gap-2">
        {tools.map(tool => (
          <button
            key={tool.id}
            onPointerDown={event => {
              event.preventDefault();
              onToolSelect?.(tool.id);
            }}
            onClick={() => onToolSelect?.(tool.id)}
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-md transition-colors',
              activeTool === tool.id
                ? 'bg-[#FAE8E5] text-[#E8462A]'
                : 'text-[#6B6860] hover:bg-[#E8E5DE] hover:text-[#1A1917]'
            )}
            title={tool.label}
          >
            <tool.icon className="h-5 w-5" />
          </button>
        ))}
      </div>
    </aside>
  );
}
