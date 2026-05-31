'use client';

import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  onShareCanvas: () => Promise<void>;
  onCollaborate: () => Promise<void>;
  onStopCollaboration?: () => void;
  feedbackMessage?: string | null;
  errorMessage?: string | null;
  isCollaborating?: boolean;
}

export function ShareModal({
  isOpen,
  onClose,
  onShareCanvas,
  onCollaborate,
  onStopCollaboration,
  feedbackMessage,
  errorMessage,
  isCollaborating = false,
}: ShareModalProps) {
  const [isSharingSnapshot, setIsSharingSnapshot] = useState(false);
  const [isStartingCollab, setIsStartingCollab] = useState(false);

  const [animState, setAnimState] = useState<'closed' | 'opening' | 'open' | 'closing'>('closed');
  const prevOpen = useRef(false);

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

  if (animState === 'closed') return null;

  const modalState = animState === 'open' ? 'is-open' : animState === 'closing' ? 'is-closing' : '';

  const handleShareCanvas = async () => {
    setIsSharingSnapshot(true);
    try {
      await onShareCanvas();
    } finally {
      setIsSharingSnapshot(false);
    }
  };

  const handleCollaborate = async () => {
    setIsStartingCollab(true);
    try {
      await onCollaborate();
    } finally {
      setIsStartingCollab(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-300 flex items-center justify-center bg-overlay backdrop-blur-sm pointer-events-auto t-modal ${modalState}"
      onClick={onClose}
    >
      <div
        className="relative bg-card border border-panel-border rounded-xl shadow-lg w-[440px] p-5"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors"
        >
          <X size={18} />
        </button>
        <h2 className="text-[15px] font-semibold text-foreground mb-1">Share</h2>
        <p className="text-[13px] text-muted-foreground mb-4">
          {isCollaborating
            ? 'Collaboration is active. Stop it anytime.'
            : 'Choose how you want to share this canvas.'}
        </p>

        <div className="space-y-2">
          {isCollaborating ? (
            <button
              onClick={() => {
                onStopCollaboration?.();
                onClose();
              }}
              className="w-full py-2 bg-primary text-primary-foreground text-[13px] font-medium rounded-md hover:bg-primary/90 transition-colors"
            >
              Stop Collaboration
            </button>
          ) : (
            <>
              <button
                onClick={handleShareCanvas}
                disabled={isSharingSnapshot || isStartingCollab}
                className="w-full py-2 bg-primary text-primary-foreground text-[13px] font-medium rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {isSharingSnapshot ? 'Sharing...' : 'Share Canvas'}
              </button>
              <button
                onClick={handleCollaborate}
                disabled={isStartingCollab || isSharingSnapshot}
                className="w-full py-2 border border-border bg-card text-foreground text-[13px] font-medium rounded-md hover:bg-secondary transition-colors disabled:opacity-50"
              >
                {isStartingCollab ? 'Starting...' : 'Collaborate'}
              </button>
            </>
          )}
          <button
            onClick={onClose}
            disabled={isStartingCollab || isSharingSnapshot}
            className="w-full py-2 border border-border bg-card text-muted-foreground text-[13px] font-medium rounded-md hover:bg-background transition-colors disabled:opacity-50"
          >
            {isCollaborating ? 'Close' : 'Cancel'}
          </button>
        </div>

        {feedbackMessage && (
          <p className="mt-3 text-[12px] text-success bg-success-bg border border-success-border rounded-md px-2 py-1.5">
            {feedbackMessage}
          </p>
        )}
        {errorMessage && (
          <p className="mt-3 text-[12px] text-error bg-error-bg border border-error-border rounded-md px-2 py-1.5">
            {errorMessage}
          </p>
        )}
      </div>
    </div>
  );
}
