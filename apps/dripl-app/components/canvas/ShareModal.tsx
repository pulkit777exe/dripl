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
      className="fixed inset-0 z-300 flex items-center justify-center bg-black/30 backdrop-blur-sm pointer-events-auto t-modal ${modalState}"
      onClick={onClose}
    >
      <div
        className="relative bg-[#FAFAF7] border border-[#E4E0D9] rounded-xl shadow-lg w-[440px] p-5"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-[#9B9890] hover:text-[#1A1917] hover:bg-[#E8E5DE] rounded-md transition-colors"
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
              className="w-full py-2 bg-[#E8462A] text-white text-[13px] font-medium rounded-md hover:bg-[#D93D22] transition-colors"
            >
              Stop Collaboration
            </button>
          ) : (
            <>
              <button
                onClick={handleShareCanvas}
                disabled={isSharingSnapshot || isStartingCollab}
                className="w-full py-2 bg-[#E8462A] text-white text-[13px] font-medium rounded-md hover:bg-[#D93D22] transition-colors disabled:opacity-50"
              >
                {isSharingSnapshot ? 'Sharing...' : 'Share Canvas'}
              </button>
              <button
                onClick={handleCollaborate}
                disabled={isStartingCollab || isSharingSnapshot}
                className="w-full py-2 border border-[#D4D0C9] bg-white text-[#1A1917] text-[13px] font-medium rounded-md hover:bg-[#E8E5DE] transition-colors disabled:opacity-50"
              >
                {isStartingCollab ? 'Starting...' : 'Collaborate'}
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
          <p className="mt-3 text-[12px] text-green-700 bg-green-50 border border-green-200 rounded-md px-2 py-1.5">
            {feedbackMessage}
          </p>
        )}
        {errorMessage && (
          <p className="mt-3 text-[12px] text-[#B42318] bg-[#FEF3F2] border border-[#FECACA] rounded-md px-2 py-1.5">
            {errorMessage}
          </p>
        )}
      </div>
    </div>
  );
}
