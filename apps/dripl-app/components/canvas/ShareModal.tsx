'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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

  const modal = (
    <div
      className={`fixed inset-0 z-400 flex items-center justify-center p-4 box-content backdrop-blur-sm pointer-events-auto t-modal ${modalState}`}
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)' }}
      onClick={onClose}
    >
      <div
        className="rounded-xl shadow-lg w-[440px] max-h-[85vh] overflow-y-auto"
        style={{ backgroundColor: '#FAFAF7', border: '1px solid #E4E0D9' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid #E4E0D9' }}>
          <h2 className="text-[15px] font-semibold" style={{ color: '#1A1917' }}>Share</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md transition-colors"
            style={{ color: '#6B6860' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#1A1917'; e.currentTarget.style.backgroundColor = '#E8E5DE'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#6B6860'; e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-[13px]" style={{ color: '#6B6860' }}>
            {isCollaborating
              ? 'Collaboration is active. Stop it anytime.'
              : 'Choose how you want to share this canvas.'}
          </p>

          {isCollaborating ? (
            <button
              onClick={() => {
                onStopCollaboration?.();
                onClose();
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-[13px] font-medium rounded-md transition-colors"
              style={{ backgroundColor: '#C0392B', color: '#ffffff' }}
            >
              <Users size={16} />
              Stop Collaboration
            </button>
          ) : (
            <>
              <button
                onClick={handleShareCanvas}
                disabled={isSharingSnapshot || isStartingCollab}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-[13px] font-medium rounded-md transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#E8462A', color: '#ffffff' }}
              >
                {isSharingSnapshot ? (
                  <Check size={16} className="animate-pulse" />
                ) : (
                  <Link2 size={16} />
                )}
                <div className="text-left flex-1">
                  <div>{isSharingSnapshot ? 'Creating link...' : 'Share Canvas'}</div>
                  <div className="text-[11px] font-normal" style={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                    Copy a snapshot link to clipboard
                  </div>
                </div>
              </button>
              <button
                onClick={handleCollaborate}
                disabled={isStartingCollab || isSharingSnapshot}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-[13px] font-medium rounded-md transition-colors disabled:opacity-50"
                style={{ border: '1px solid #D4D0C9', backgroundColor: '#FAFAF7', color: '#1A1917' }}
              >
                {isStartingCollab ? (
                  <Check size={16} className="animate-pulse" />
                ) : (
                  <Users size={16} />
                )}
                <div className="text-left flex-1">
                  <div>{isStartingCollab ? 'Starting session...' : 'Collaborate'}</div>
                  <div className="text-[11px] font-normal" style={{ color: '#6B6860' }}>
                    Start a real-time collaboration session
                  </div>
                </div>
              </button>
            </>
          )}

          <button
            onClick={onClose}
            disabled={isStartingCollab || isSharingSnapshot}
            className="w-full py-2 text-[13px] font-medium rounded-md transition-colors disabled:opacity-50"
            style={{ border: '1px solid #D4D0C9', backgroundColor: '#FAFAF7', color: '#6B6860' }}
          >
            {isCollaborating ? 'Close' : 'Cancel'}
          </button>
        </div>

        {feedbackMessage && (
          <div className="px-5 pb-5">
            <div className="flex items-center gap-2 px-3 py-2 rounded-md" style={{ backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0' }}>
              <Check size={14} style={{ color: '#16A34A' }} />
              <span className="text-[12px] font-medium" style={{ color: '#16A34A' }}>{feedbackMessage}</span>
            </div>
          </div>
        )}
        {errorMessage && (
          <div className="px-5 pb-5">
            <div className="flex items-center gap-2 px-3 py-2 rounded-md" style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA' }}>
              <X size={14} style={{ color: '#B42318' }} />
              <span className="text-[12px] font-medium" style={{ color: '#B42318' }}>{errorMessage}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
