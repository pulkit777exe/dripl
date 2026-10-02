'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { Frame, Globe, Zap, Sparkles, ChevronDown, Wand2, Library } from 'lucide-react';
import { useCanvasStore } from '@/lib/store';

const AIGenerateModal = dynamic(() => import('./AIGenerateModal').then(m => m.AIGenerateModal), {
  ssr: false,
});
const EmbedUrlModal = dynamic(() => import('./EmbedUrlModal').then(m => m.EmbedUrlModal), {
  ssr: false,
});

interface ExtraTool {
  id: string;
  label: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  shortcut?: string;
  perform?: () => void;
  disabled?: boolean;
  helperLabel?: string;
}

function ToolIcon({
  icon,
  size = 16,
  className,
}: {
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  size?: number;
  className?: string;
}) {
  if (!icon) return null;
  const Icon = icon;
  return <Icon size={size} className={className} />;
}

export function ExtraToolsDropdown({ readOnly = false }: { readOnly?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [showEmbedModal, setShowEmbedModal] = useState(false);
  const [closing, setClosing] = useState(false);
  const prevOpen = useRef(isOpen);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const setActiveTool = useCanvasStore(state => state.setActiveTool);
  const activeTool = useCanvasStore(state => state.activeTool);

  useEffect(() => {
    if (!readOnly) return;
    setIsOpen(false);
    setShowAIModal(false);
    setShowEmbedModal(false);
  }, [readOnly]);

  useEffect(() => {
    if (!isOpen && prevOpen.current) {
      prevOpen.current = false;
      setClosing(true);
    } else if (isOpen) {
      setClosing(false);
      prevOpen.current = true;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!closing) return;
    const ms =
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--dropdown-close-dur')
      ) || 150;
    const timer = setTimeout(() => setClosing(false), ms);
    return () => clearTimeout(timer);
  }, [closing]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(288, Math.max(220, window.innerWidth - 16));
      setMenuPosition({
        top: Math.min(window.innerHeight - 16, rect.bottom + 8),
        right: Math.max(8, Math.min(window.innerWidth - width - 8, window.innerWidth - rect.right)),
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const menu = menuRef.current;
    const getItems = () =>
      Array.from(
        menu?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not([disabled])') ?? []
      );

    // Move focus into the menu when it is opened from the keyboard. The menu
    // remains a small, predictable roving-focus surface rather than leaving
    // focus on the trigger behind the popover.
    getItems()[0]?.focus();

    const handleMenuKeyDown = (event: KeyboardEvent) => {
      const items = getItems();
      if (items.length === 0) return;
      const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);

      if (event.key === 'Escape') {
        event.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const nextIndex =
          currentIndex < 0 ? 0 : (currentIndex + direction + items.length) % items.length;
        items[nextIndex]?.focus();
        return;
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
      }
    };

    document.addEventListener('keydown', handleMenuKeyDown);
    return () => document.removeEventListener('keydown', handleMenuKeyDown);
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
        setShowEmbedModal(true);
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

  const isButtonActive =
    isOpen || activeTool === 'frame' || activeTool === 'laser' || activeTool === 'embed';

  const renderActiveIcon = () => {
    if (activeTool === 'frame') return <Frame size={18} />;
    if (activeTool === 'laser') return <Zap size={18} />;
    if (activeTool === 'embed') return <Globe size={18} />;
    return <Library size={18} />;
  };

  const handleEmbedSubmit = (url: string, title?: string) => {
    // Store the URL and title in the canvas store for the embed tool
    const store = useCanvasStore.getState();
    store.setPendingEmbed?.(url, title);
    setActiveTool('embed');
  };

  return (
    <>
      <div className="relative" ref={dropdownRef}>
        <button
          ref={triggerRef}
          id="canvas-extra-tools-trigger"
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          disabled={readOnly}
          className="relative shrink-0 p-1.5 sm:p-2 rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          style={
            isButtonActive
              ? {
                  backgroundColor: 'var(--color-tool-active-bg)',
                  color: 'var(--color-tool-active-text)',
                }
              : { backgroundColor: 'transparent', color: 'var(--color-tool-inactive-text)' }
          }
          aria-label="Frame and library tools"
          aria-expanded={isOpen}
          aria-controls={menuId}
          aria-haspopup="true"
          aria-pressed={isButtonActive}
          title="Frame / Library"
        >
          {renderActiveIcon()}
          <ChevronDown
            size={11}
            className={`absolute -bottom-0.5 -right-0.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {typeof document !== 'undefined' &&
          (isOpen || closing) &&
          createPortal(
            <div
              ref={menuRef}
              id={menuId}
              className={`t-dropdown fixed w-[min(18rem,calc(100vw-2rem))] rounded-xl border shadow-2xl z-[1000] py-1.5 ${isOpen ? 'is-open' : closing ? 'is-closing' : ''}`}
              data-origin="top-right"
              role="menu"
              aria-label="More drawing tools"
              style={{
                top: menuPosition.top,
                right: menuPosition.right,
                backgroundColor: 'var(--color-panel-bg)',
                borderColor: 'var(--color-panel-border)',
              }}
            >
              <div
                className="px-3 py-1.5 text-[11px] font-semibold tracking-wide uppercase"
                style={{ color: 'var(--color-panel-label)' }}
              >
                Extended Tools
              </div>

              {extendedTools.map(tool => {
                return (
                  <button
                    type="button"
                    key={tool.id}
                    onClick={tool.perform}
                    role="menuitem"
                    tabIndex={-1}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm transition-colors hover:opacity-80"
                    style={{ color: 'var(--color-panel-text)', backgroundColor: 'transparent' }}
                  >
                    <div className="flex items-center gap-2.5">
                      <ToolIcon icon={tool.icon} size={16} className="text-[#6B6860]" />
                      <span>{tool.label}</span>
                    </div>
                    {tool.shortcut && (
                      <span
                        className="text-[11px] font-mono px-1.5 py-0.5 rounded"
                        style={{
                          backgroundColor: 'var(--color-panel-btn-bg)',
                          color: 'var(--color-panel-label)',
                        }}
                      >
                        {tool.shortcut}
                      </span>
                    )}
                  </button>
                );
              })}

              <div
                className="my-1.5 h-px"
                style={{ backgroundColor: 'var(--color-panel-divider)' }}
              />

              <div
                className="px-3 py-1.5 text-[11px] font-semibold tracking-wide uppercase flex items-center gap-1.5"
                style={{ color: 'var(--color-panel-label)' }}
              >
                <Sparkles size={12} style={{ color: '#E8462A' }} />
                Generate
              </div>

              {generateTools.map(tool => {
                const isDisabled = Boolean(tool.disabled);

                return (
                  <button
                    type="button"
                    key={tool.id}
                    onClick={isDisabled ? undefined : tool.perform}
                    disabled={isDisabled}
                    role="menuitem"
                    tabIndex={-1}
                    aria-disabled={isDisabled}
                    title={isDisabled ? 'Coming Soon' : tool.label}
                    className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                      isDisabled
                        ? 'opacity-55 cursor-not-allowed bg-transparent'
                        : 'hover:opacity-80'
                    }`}
                    style={{
                      color: isDisabled ? 'var(--color-panel-label)' : 'var(--color-panel-text)',
                    }}
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
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded border"
                        style={{
                          backgroundColor: 'var(--color-panel-btn-bg)',
                          borderColor: 'var(--color-panel-border)',
                          color: 'var(--color-panel-label)',
                        }}
                      >
                        {tool.helperLabel}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>,
            document.body
          )}
      </div>

      <AIGenerateModal isOpen={showAIModal} onClose={() => setShowAIModal(false)} />
      <EmbedUrlModal
        isOpen={showEmbedModal}
        onClose={() => setShowEmbedModal(false)}
        onSubmit={handleEmbedSubmit}
      />
    </>
  );
}
