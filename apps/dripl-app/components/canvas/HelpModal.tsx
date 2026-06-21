'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle, X, BookOpen, ExternalLink, Github, Youtube, Keyboard } from 'lucide-react';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItemProps {
  toolName: string;
  shortcut: string;
}

function ShortcutItem({ toolName, shortcut }: ShortcutItemProps) {
  return (
    <div className="flex justify-between items-center py-1.5" style={{ borderBottom: '1px solid #E4E0D9' }}>
      <div className="text-[13px] flex-1" style={{ color: '#6B6860' }}>{toolName}</div>
      <div className="text-[11px] font-mono px-2 py-0.5 rounded min-w-12 text-center" style={{ backgroundColor: '#EAE6DE', color: '#6B6860', border: '1px solid #E4E0D9' }}>
        {shortcut}
      </div>
    </div>
  );
}

interface HeaderButtonProps {
  icon: React.ReactNode;
  label: string;
}

function HeaderButton({ icon, label }: HeaderButtonProps) {
  return (
    <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] transition-colors" style={{ backgroundColor: '#FAFAF7', color: '#6B6860', border: '1px solid #E4E0D9' }}>
      {icon}
      {label}
    </button>
  );
}

export default function HelpModal({ isOpen, onClose }: HelpModalProps) {
  const [mounted, setMounted] = useState(false);
  const [animState, setAnimState] = useState<'closed' | 'opening' | 'open' | 'closing'>('closed');
  const prevOpen = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen && !prevOpen.current) {
      prevOpen.current = true;
      setAnimState('opening');
    } else if (!isOpen && prevOpen.current) {
      prevOpen.current = false;
      setAnimState('closing');
    }
  }, [isOpen]);

  useEffect(() => {
    if (animState === 'opening') {
      const raf = requestAnimationFrame(() => setAnimState('open'));
      return () => cancelAnimationFrame(raf);
    }
    if (animState === 'closing') {
      const ms = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--modal-close-dur')
      ) || 150;
      const timer = setTimeout(() => setAnimState('closed'), ms);
      return () => clearTimeout(timer);
    }
  }, [animState]);

  if (!mounted || animState === 'closed') return null;

  const modalState = animState === 'open' ? 'is-open' : animState === 'closing' ? 'is-closing' : '';

  const modal = (
    <div
      className={`fixed inset-0 z-400 flex items-center justify-center p-4 box-content backdrop-blur-sm pointer-events-auto t-modal ${modalState}`}
      style={{ backgroundColor: 'rgba(26, 25, 23, 0.6)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl rounded-xl shadow-lg max-h-[90vh] overflow-hidden flex flex-col"
        style={{ backgroundColor: '#FAFAF7', border: '1px solid #E4E0D9' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center px-5 py-3.5" style={{ borderBottom: '1px solid #E4E0D9' }}>
          <h2 className="text-[15px] font-semibold flex items-center gap-2" style={{ color: '#1A1917' }}>
            <HelpCircle size={18} style={{ color: '#E8462A' }} />
            Help
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md transition-colors"
            style={{ color: '#6B6860' }}
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-3 flex gap-2 flex-wrap" style={{ borderBottom: '1px solid #E4E0D9' }}>
          <HeaderButton icon={<BookOpen size={14} />} label="Documentation" />
          <HeaderButton icon={<ExternalLink size={14} />} label="Blog" />
          <HeaderButton icon={<Github size={14} />} label="GitHub" />
          <HeaderButton icon={<Youtube size={14} />} label="YouTube" />
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          <h3 className="text-[14px] font-semibold mb-3 flex items-center gap-2" style={{ color: '#1A1917' }}>
            <Keyboard size={16} style={{ color: '#6B6860' }} />
            Keyboard shortcuts
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-0 text-sm">
            <div>
              <h4 className="text-[11px] font-semibold uppercase tracking-wider mb-2 mt-3" style={{ color: '#6B6860' }}>
                Tools
              </h4>
              <ShortcutItem toolName="Hand (panning tool)" shortcut="H" />
              <ShortcutItem toolName="Selection" shortcut="V or 1" />
              <ShortcutItem toolName="Rectangle" shortcut="R or 2" />
              <ShortcutItem toolName="Diamond" shortcut="D or 3" />
              <ShortcutItem toolName="Draw (freehand)" shortcut="P or 7" />
              <ShortcutItem toolName="Ellipse" shortcut="O or 4" />
              <ShortcutItem toolName="Arrow" shortcut="A or 5" />
              <ShortcutItem toolName="Line" shortcut="L or 6" />
              <ShortcutItem toolName="Text" shortcut="T or 8" />
              <ShortcutItem toolName="Insert image" shortcut="9" />
              <ShortcutItem toolName="Eraser" shortcut="X or 0" />
              <ShortcutItem toolName="Frame" shortcut="F" />
            </div>

            <div>
              <h4 className="text-[11px] font-semibold uppercase tracking-wider mb-2 mt-3" style={{ color: '#6B6860' }}>
                Editor
              </h4>
              <ShortcutItem toolName="Move canvas" shortcut="Space + Drag" />
              <ShortcutItem toolName="Delete" shortcut="Delete" />
              <ShortcutItem toolName="Cut" shortcut="Ctrl+X" />
              <ShortcutItem toolName="Copy" shortcut="Ctrl+C" />
              <ShortcutItem toolName="Paste" shortcut="Ctrl+V" />
              <ShortcutItem toolName="Select all" shortcut="Ctrl+A" />
              <ShortcutItem toolName="Undo" shortcut="Ctrl+Z" />
              <ShortcutItem toolName="Redo" shortcut="Ctrl+Shift+Z" />
              <ShortcutItem toolName="Zoom in" shortcut="Ctrl + +" />
              <ShortcutItem toolName="Zoom out" shortcut="Ctrl + -" />
              <ShortcutItem toolName="Reset zoom" shortcut="Ctrl+0" />
              <ShortcutItem toolName="Toggle grid" shortcut="Ctrl+G" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
