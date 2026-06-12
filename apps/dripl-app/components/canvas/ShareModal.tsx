'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Link2, Users, Check } from 'lucide-react';

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
      className={`fixed inset-0 z-300 flex items-center justify-center bg-overlay backdrop-blur-sm pointer-events-auto t-modal ${modalState}`}
      onClick={onClose}
    >
      <div
        className="relative bg-[#FAFAF7] border border-[#D4D0C9] rounded-xl shadow-lg w-[440px] p-5"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-[#6B6860] hover:text-[#1A1917] hover:bg-[#E8E5DE] rounded-md transition-colors"
        >
          <X size={18} />
        </button>

        <h2 className="text-[15px] font-semibold text-[#1A1917] mb-1">Share</h2>
        <p className="text-[13px] text-[#6B6860] mb-4">
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
              className="w-full flex items-center gap-3 px-3 py-2.5 bg-[#C0392B] text-white text-[13px] font-medium rounded-md hover:bg-[#C0392B]/90 transition-colors"
            >
              <Users size={16} />
              Stop Collaboration
            </button>
          ) : (
            <>
              <button
                onClick={handleShareCanvas}
                disabled={isSharingSnapshot || isStartingCollab}
                className="w-full flex items-center gap-3 px-3 py-2.5 bg-[#E8462A] text-white text-[13px] font-medium rounded-md hover:bg-[#E8462A]/90 transition-colors disabled:opacity-50"
              >
                {isSharingSnapshot ? (
                  <Check size={16} className="animate-pulse" />
                ) : (
                  <Link2 size={16} />
                )}
                <div className="text-left flex-1">
                  <div>{isSharingSnapshot ? 'Creating link...' : 'Share Canvas'}</div>
                  <div className="text-[11px] text-white/70 font-normal">
                    Copy a snapshot link to clipboard
                  </div>
                </div>
              </button>
              <button
                onClick={handleCollaborate}
                disabled={isStartingCollab || isSharingSnapshot}
                className="w-full flex items-center gap-3 px-3 py-2.5 border border-[#D4D0C9] bg-[#FAFAF7] text-[#1A1917] text-[13px] font-medium rounded-md hover:bg-[#E8E5DE] transition-colors disabled:opacity-50"
              >
                {isStartingCollab ? (
                  <Check size={16} className="animate-pulse" />
                ) : (
                  <Users size={16} />
                )}
                <div className="text-left flex-1">
                  <div>{isStartingCollab ? 'Starting session...' : 'Collaborate'}</div>
                  <div className="text-[11px] text-[#6B6860] font-normal">
                    Start a real-time collaboration session
                  </div>
                </div>
              </button>
            </>
          )}
          <button
            onClick={onClose}
            disabled={isStartingCollab || isSharingSnapshot}
            className="w-full py-2 border border-[#D4D0C9] bg-[#FAFAF7] text-[#6B6860] text-[13px] font-medium rounded-md hover:bg-[#F0EDE6] transition-colors disabled:opacity-50"
          >
            {isCollaborating ? 'Close' : 'Cancel'}
          </button>
        </div>

        {feedbackMessage && (
          <div className="flex items-center gap-2 mt-3 px-3 py-2 bg-[#E8F5E9] border border-[#A5D6A7] rounded-md">
            <Check size={14} className="text-[#2E7D32]" />
            <span className="text-[12px] text-[#2E7D32] font-medium">{feedbackMessage}</span>
          </div>
        )}
        {errorMessage && (
          <div className="flex items-center gap-2 mt-3 px-3 py-2 bg-[#FFEBEE] border border-[#EF9A9A] rounded-md">
            <X size={14} className="text-[#C62828]" />
            <span className="text-[12px] text-[#C62828] font-medium">{errorMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
}
