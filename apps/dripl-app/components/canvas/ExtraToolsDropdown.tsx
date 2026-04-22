'use client';

import { useState, useRef, useEffect } from 'react';
import { Frame, Globe, Zap, Sparkles, ChevronDown, Wand2, Library } from 'lucide-react';
import { useCanvasStore } from '@/lib/canvas-store';
import { AIGenerateModal } from './AIGenerateModal';

interface ExtraTool {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  shortcut?: string;
  perform?: () => void;
  disabled?: boolean;
  helperLabel?: string;
}

export function ExtraToolsDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const setActiveTool = useCanvasStore(state => state.setActiveTool);
  const activeTool = useCanvasStore(state => state.activeTool);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const extendedTools: ExtraTool[] = [
    {
      id: 'frame-tool',
      label: 'Frame Tool',
      icon: Frame,
      shortcut: 'F',
      perform: () => {
        setActiveTool('frame');
        setIsOpen(false);
      },
    },
    {
      id: 'web-embed',
      label: 'Web Embed',
      icon: Globe,
      perform: () => {
        setIsOpen(false);
      },
    },
    {
      id: 'laser-pointer',
      label: 'Laser Pointer',
      icon: Zap,
      perform: () => {
        setActiveTool('laser');
        setIsOpen(false);
      },
    },
  ];

  const generateTools: ExtraTool[] = [
    {
      id: 'text-to-diagram',
      label: 'Text to Diagram (AI)',
      icon: Wand2,
      perform: () => {
        setShowAIModal(true);
        setIsOpen(false);
      },
    },
    {
      id: 'mermaid',
      label: 'Mermaid to Dripl',
      icon: Sparkles,
      disabled: true,
      helperLabel: 'Coming Soon',
    },
    {
      id: 'wireframe',
      label: 'Wireframe to Code (AI)',
      icon: Sparkles,
      disabled: true,
      helperLabel: 'Coming Soon',
    },
  ];

  const isButtonActive = isOpen || activeTool === 'frame';

  return (
    <>
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={
            isButtonActive
              ? 'relative p-2 rounded-md bg-tool-active-bg text-tool-active-text transition-colors'
              : 'relative p-2 rounded-md text-tool-inactive-text hover:bg-tool-hover-bg hover:text-tool-hover-text transition-colors'
          }
          aria-label="Frame and library tools"
          aria-expanded={isOpen}
          aria-haspopup="true"
          title="Frame / Library"
        >
          <Library size={18} />
          <ChevronDown
            size={11}
            className={`absolute -bottom-0.5 -right-0.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {isOpen && (
          <div className="absolute top-full right-0 mt-2 w-72 bg-panel-bg rounded-xl border border-panel-border shadow-2xl z-[60] py-1.5">
            <div className="px-3 py-1.5 text-[11px] font-semibold tracking-wide uppercase text-panel-label">
              Extended Tools
            </div>

            {extendedTools.map(tool => {
              const Icon = tool.icon;
              return (
                <button
                  key={tool.id}
                  onClick={tool.perform}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm text-panel-text hover:bg-panel-btn-hover transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <Icon size={16} className="text-panel-label" />
                    <span>{tool.label}</span>
                  </div>
                  {tool.shortcut && (
                    <span className="text-[11px] text-panel-label font-mono px-1.5 py-0.5 rounded bg-panel-btn-bg">
                      {tool.shortcut}
                    </span>
                  )}
                </button>
              );
            })}

            <div className="my-1.5 h-px bg-panel-divider" />

            <div className="px-3 py-1.5 text-[11px] font-semibold tracking-wide uppercase text-panel-label flex items-center gap-1.5">
              <Sparkles size={12} className="text-primary" />
              Generate
            </div>

            {generateTools.map(tool => {
              const Icon = tool.icon;
              const isDisabled = Boolean(tool.disabled);

              return (
                <button
                  key={tool.id}
                  onClick={isDisabled ? undefined : tool.perform}
                  disabled={isDisabled}
                  title={isDisabled ? 'Coming Soon' : tool.label}
                  className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                    isDisabled
                      ? 'text-panel-label opacity-55 cursor-not-allowed bg-transparent'
                      : 'text-panel-text hover:bg-panel-btn-hover'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon size={16} className={isDisabled ? 'text-panel-label' : 'text-primary'} />
                    <span>{tool.label}</span>
                  </div>
                  {tool.helperLabel && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-panel-btn-bg text-panel-label border border-panel-border">
                      {tool.helperLabel}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <AIGenerateModal isOpen={showAIModal} onClose={() => setShowAIModal(false)} />
    </>
  );
}
