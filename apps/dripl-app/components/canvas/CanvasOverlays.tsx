'use client';

import { Suspense, lazy } from 'react';
import type { DriplElement } from '@dripl/common';
import { useCanvasStore, type ActiveTool, type CanvasTextInput } from '@/lib/store';
import type { ContextMenuState } from '@/hooks/canvas/useContextMenu';

const ContextMenu = lazy(() => import('./ContextMenu').then(m => ({ default: m.ContextMenu })));

/**
 * Canvas overlays — presentational components extracted from RoughCanvas.
 *
 * Each overlay is a pure function of props (no store subscriptions inside),
 * so the orchestrator keeps every subscription and the JSX stays a flat
 * composition root. Behavior is verbatim: same markup, same handlers.
 */

export function ConnectionStatusBanner({
  roomSlug,
  isConnected,
  connectionMessage,
  readOnly,
}: {
  roomSlug: string | null;
  isConnected: boolean;
  connectionMessage: string;
  readOnly: boolean;
}) {
  if (!roomSlug || (isConnected && connectionMessage === 'Connected' && !readOnly)) return null;
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-16 z-30 -translate-x-1/2 rounded-full border border-[#D4D0C9] bg-white/95 px-3 py-1.5 text-xs text-[#6B6860] shadow"
      role="status"
      aria-live="polite"
    >
      {readOnly ? 'View only' : connectionMessage}
    </div>
  );
}

export function TextInputOverlay({
  textInput,
  readOnly,
  zoom,
  panX,
  panY,
  onSubmit,
}: {
  textInput: CanvasTextInput | null;
  readOnly: boolean;
  zoom: number;
  panX: number;
  panY: number;
  onSubmit: (text: string) => void;
}) {
  if (!textInput || readOnly) return null;
  return (
    <textarea
      ref={el => el?.focus()}
      defaultValue={textInput.value ?? ''}
      className="canvas-text-input absolute outline-none resize-none"
      style={{
        left: `${textInput.x * zoom + panX}px`,
        top: `${textInput.y * zoom + panY}px`,
        fontSize: `${20 * zoom}px`,
        lineHeight: 1.4,
        color: 'var(--color-default-stroke)',
        background: 'transparent',
        border: '1.5px dashed #6965db',
        borderRadius: 2,
        minWidth: '160px',
        minHeight: '28px',
        padding: '2px 4px',
        zIndex: 1000,
      }}
      onBlur={e => {
        if (e.target.value.trim()) onSubmit(e.target.value);
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onSubmit(e.currentTarget.value);
        }
        if (e.key === 'Escape') useCanvasStore.getState().setTextInput(null);
      }}
      placeholder="Type text…"
    />
  );
}

export function EraserCursorRing({
  activeTool,
  cursorPosition,
  zoom,
  panX,
  panY,
}: {
  activeTool: ActiveTool;
  cursorPosition: { x: number; y: number } | null;
  zoom: number;
  panX: number;
  panY: number;
}) {
  if (activeTool !== 'eraser' || !cursorPosition) return null;
  return (
    <div
      className="absolute pointer-events-none rounded-full border"
      style={{
        left: `${cursorPosition.x * zoom + panX - 20}px`,
        top: `${cursorPosition.y * zoom + panY - 20}px`,
        width: 40,
        height: 40,
        borderColor: 'rgba(255,255,255,0.75)',
        backgroundColor: 'rgba(255,255,255,0.08)',
        zIndex: 40,
      }}
    />
  );
}

export function CanvasContextMenuHost({
  contextMenuState,
  readOnly,
  elements,
  onClose,
  onDuplicate,
  onDelete,
  onBringToFront,
  onSendToBack,
  onCopy,
  onPaste,
  onCopyStyle,
  onPasteStyle,
}: {
  contextMenuState: ContextMenuState | null;
  readOnly: boolean;
  elements: DriplElement[];
  onClose: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onCopyStyle: () => void;
  onPasteStyle: () => void;
}) {
  if (!contextMenuState || readOnly) return null;
  return (
    <Suspense fallback={null}>
      <ContextMenu
        x={contextMenuState.x}
        y={contextMenuState.y}
        element={elements.find(element => element.id === contextMenuState.elementId) ?? null}
        onClose={onClose}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        onBringToFront={onBringToFront}
        onSendToBack={onSendToBack}
        onCopy={onCopy}
        onPaste={onPaste}
        onCopyStyle={onCopyStyle}
        onPasteStyle={onPasteStyle}
      />
    </Suspense>
  );
}
