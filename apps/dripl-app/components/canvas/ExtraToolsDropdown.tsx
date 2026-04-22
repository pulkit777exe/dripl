'use client';

import { useState, useRef, useEffect } from 'react';
import { Frame, Globe, Zap, Sparkles, ChevronDown, Wand2, Library } from 'lucide-react';
import { useCanvasStore } from '@/lib/canvas-store';
import { AIGenerateModal } from './AIGenerateModal';

interface ExtraTool {
  id: string;
  label: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  shortcut?: string;
  perform?: () => void;
  disabled?: boolean;
  helperLabel?: string;
}

function ToolIcon({ icon, size = 16, className }: { icon?: React.ComponentType<{ size?: number; className?: string }>; size?: number; className?: string }) {
  if (!icon) return null;
  const Icon = icon;
  return <Icon size={size} className={className} />;
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

  const isButtonActive = isOpen || activeTool === 'frame' || activeTool === 'laser';
  
  const renderActiveIcon = () => {
    if (activeTool === 'frame') return <Frame size={18} />;
    if (activeTool === 'laser') return <Zap size={18} />;
    return <Library size={18} />;
  };

  return (
    <>
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="relative p-2 rounded-md transition-colors"
          style={
            isButtonActive
              ? { backgroundColor: 'var(--color-tool-active-bg)', color: 'var(--color-tool-active-text)' }
              : { backgroundColor: 'transparent', color: 'var(--color-tool-inactive-text)' }
          }
          aria-label="Frame and library tools"
          aria-expanded={isOpen}
          aria-haspopup="true"
          title="Frame / Library"
        >
          {renderActiveIcon()}
          <ChevronDown
            size={11}
            className={`absolute -bottom-0.5 -right-0.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {isOpen && (
          <div 
            className="absolute top-full right-0 mt-2 w-72 rounded-xl border shadow-2xl z-60 py-1.5"
            style={{ backgroundColor: 'var(--color-panel-bg)', borderColor: 'var(--color-panel-border)' }}
          >
            <div className="px-3 py-1.5 text-[11px] font-semibold tracking-wide uppercase" style={{ color: 'var(--color-panel-label)' }}>
              Extended Tools
            </div>

            {extendedTools.map(tool => {
              return (
                <button
                  key={tool.id}
                  onClick={tool.perform}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm transition-colors hover:opacity-80"
                  style={{ color: 'var(--color-panel-text)', backgroundColor: 'transparent' }}
                >
                  <div className="flex items-center gap-2.5">
                    <ToolIcon icon={tool.icon} size={16} className="text-[#6B6860]" />
                    <span>{tool.label}</span>
                  </div>
                  {tool.shortcut && (
                    <span className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-panel-btn-bg)', color: 'var(--color-panel-label)' }}>
                      {tool.shortcut}
                    </span>
                  )}
                </button>
              );
            })}

            <div className="my-1.5 h-px" style={{ backgroundColor: 'var(--color-panel-divider)' }} />

            <div className="px-3 py-1.5 text-[11px] font-semibold tracking-wide uppercase flex items-center gap-1.5" style={{ color: 'var(--color-panel-label)' }}>
              <Sparkles size={12} style={{ color: '#E8462A' }} />
              Generate
            </div>

            {generateTools.map(tool => {
              const isDisabled = Boolean(tool.disabled);

              return (
                <button
                  key={tool.id}
                  onClick={isDisabled ? undefined : tool.perform}
                  disabled={isDisabled}
                  title={isDisabled ? 'Coming Soon' : tool.label}
                  className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                    isDisabled
                      ? 'opacity-55 cursor-not-allowed bg-transparent'
                      : 'hover:opacity-80'
                  }`}
                  style={{ color: isDisabled ? 'var(--color-panel-label)' : 'var(--color-panel-text)' }}
                >
                  <div className="flex items-center gap-2.5">
                    <ToolIcon 
                      icon={tool.icon} 
                      size={16} 
                      className={isDisabled ? 'text-[#6B6860]' : 'text-[#E8462A]'} 
                    />
                    <span>{tool.label}</span>
                  </div>
                  {tool.helperLabel && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border" style={{ backgroundColor: 'var(--color-panel-btn-bg)', borderColor: 'var(--color-panel-border)', color: 'var(--color-panel-label)' }}>
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
