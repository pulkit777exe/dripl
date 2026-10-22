'use client';

import { useEffect, useRef } from 'react';
import type { PropsWithChildren } from 'react';
import { createPortal } from 'react-dom';

interface CanvasModalProps extends PropsWithChildren {
  /** The animation state is owned by the caller; this primitive is unopinionated about motion. */
  className?: string;
  overlayClassName?: string;
  overlayStyle?: React.CSSProperties;
  contentClassName?: string;
  contentStyle?: React.CSSProperties;
  onClose?: () => void;
  closeOnBackdrop?: boolean;
  labelledBy?: string;
}

/**
 * Shared canvas-dialog shell.
 *
 * Canvas dialogs used to each reimplement portals and backdrop clicks, with
 * different keyboard and accessibility behaviour. This component intentionally
 * keeps visual styling with each dialog, but makes dismissal and focus rules
 * consistent everywhere.
 */
export function CanvasModal({
  children,
  className = '',
  overlayClassName = '',
  overlayStyle = { backgroundColor: 'rgba(26, 25, 23, 0.6)' },
  contentClassName = '',
  contentStyle,
  onClose,
  closeOnBackdrop = true,
  labelledBy,
}: CanvasModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!onClose) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const autofocus = content.querySelector<HTMLElement>('[autofocus], [data-autofocus]');
    (autofocus ?? content).focus();
  }, []);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-400 flex items-center justify-center p-4 box-content backdrop-blur-sm pointer-events-auto t-modal ${overlayClassName} ${className}`}
      style={overlayStyle}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onClick={event => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose?.();
      }}
    >
      <div ref={contentRef} className={contentClassName} style={contentStyle} tabIndex={-1}>
        {children}
      </div>
    </div>,
    document.body
  );
}
