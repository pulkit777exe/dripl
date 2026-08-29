'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DriplElement } from '@dripl/common';
import { Copy, Trash2, Layers, RotateCcw, ClipboardPaste } from 'lucide-react';

interface ContextMenuProps {
  x: number;
  y: number;
  element: DriplElement | null;
  onClose: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
}

export function ContextMenu({
  x,
  y,
  element,
  onClose,
  onDuplicate,
  onDelete,
  onBringToFront,
  onSendToBack,
  onCopy,
  onPaste,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setShow(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleClose = useCallback(() => {
    setClosing(true);
    const ms = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--dropdown-close-dur')
    ) || 150;
    setTimeout(() => {
      setClosing(false);
      onClose();
    }, ms);
  }, [onClose]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [handleClose]);

  if (!element && !closing) return null;

  return (
    <div
      ref={menuRef}
      className={`t-dropdown absolute z-50 rounded-lg shadow-lg py-1 min-w-50 ${show && !closing ? 'is-open' : closing ? 'is-closing' : ''}`}
      style={{
        left: `${x}px`,
        top: `${y}px`,
        backgroundColor: 'var(--color-card)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-foreground)',
      }}
      role="menu"
      aria-label="Element context menu"
    >
      {onCopy && (
        <button
          className="w-full px-4 py-2 text-left hover:bg-[#FAE8E5] flex items-center gap-2 text-[#1A1917]"
          onClick={() => {
            onCopy();
            handleClose();
          }}
          role="menuitem"
        >
          <Copy className="w-4 h-4" />
          Copy
        </button>
      )}
      {onPaste && (
        <button
          className="w-full px-4 py-2 text-left hover:bg-[#FAE8E5] flex items-center gap-2 text-[#1A1917]"
          onClick={() => {
            onPaste();
            handleClose();
          }}
          role="menuitem"
        >
          <ClipboardPaste className="w-4 h-4" />
          Paste
        </button>
      )}
      <button
        className="w-full px-4 py-2 text-left hover:bg-[#FAE8E5] flex items-center gap-2 text-[#1A1917]"
        onClick={() => {
          onDuplicate();
          handleClose();
        }}
        role="menuitem"
      >
        <Copy className="w-4 h-4" />
        Duplicate
      </button>
      <div className="border-t border-[#E4E0D9] my-1" />
      <button
        className="w-full px-4 py-2 text-left hover:bg-[#FAE8E5] flex items-center gap-2 text-[#1A1917]"
        onClick={() => {
          onBringToFront();
          handleClose();
        }}
        role="menuitem"
      >
        <Layers className="w-4 h-4" />
        Bring to Front
      </button>
      <button
        className="w-full px-4 py-2 text-left hover:bg-[#FAE8E5] flex items-center gap-2 text-[#1A1917]"
        onClick={() => {
          onSendToBack();
          handleClose();
        }}
        role="menuitem"
      >
        <RotateCcw className="w-4 h-4" />
        Send to Back
      </button>
      <div className="border-t border-[#E4E0D9] my-1" />
      <button
        className="w-full px-4 py-2 text-left hover:bg-[#FAE8E5] text-[#C0392B] flex items-center gap-2"
        onClick={() => {
          onDelete();
          handleClose();
        }}
        role="menuitem"
      >
        <Trash2 className="w-4 h-4" />
        Delete
      </button>
    </div>
  );
}
