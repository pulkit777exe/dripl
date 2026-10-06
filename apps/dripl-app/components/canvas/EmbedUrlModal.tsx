'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Globe, X, ExternalLink } from 'lucide-react';
import { useModalAnimation } from '@/hooks/useModalAnimation';

interface EmbedUrlModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (url: string, title?: string) => void;
}

export function EmbedUrlModal({ isOpen, onClose, onSubmit }: EmbedUrlModalProps) {
  const { animState, modalState, isVisible } = useModalAnimation(isOpen);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  // Reset the form once the close animation completes.
  useEffect(() => {
    if (animState === 'closed') {
      setUrl('');
      setTitle('');
      setError('');
    }
  }, [animState]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      setError('Please enter a URL');
      return;
    }

    try {
      new URL(url);
      onSubmit(url, title || undefined);
      onClose();
    } catch {
      setError('Please enter a valid URL');
    }
  };

  if (!isVisible) return null;

  const modal = (
    <div
      className={`fixed inset-0 z-400 flex items-center justify-center p-4 box-content backdrop-blur-sm pointer-events-auto t-modal ${modalState}`}
      style={{ backgroundColor: 'rgba(26, 25, 23, 0.6)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl shadow-lg p-5"
        style={{ backgroundColor: '#FAFAF7', border: '1px solid #E4E0D9' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div
              className="h-8 w-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: '#E8462A' }}
            >
              <Globe className="h-4 w-4" style={{ color: '#FAFAF7' }} />
            </div>
            <h3 className="text-[15px] font-semibold" style={{ color: '#1A1917' }}>
              Embed Web Content
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md transition-colors"
            style={{ color: '#6B6860' }}
          >
            <X size={18} />
          </button>
        </div>

        <p className="text-[13px] mb-4" style={{ color: '#6B6860' }}>
          Enter a URL to embed web content on the canvas.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label
              className="text-[11px] font-semibold uppercase tracking-wider block mb-1"
              style={{ color: '#6B6860' }}
            >
              URL
            </label>
            <input
              type="url"
              value={url}
              onChange={e => {
                setUrl(e.target.value);
                setError('');
              }}
              placeholder="https://example.com"
              className="w-full px-3 py-2.5 rounded-md text-[14px] outline-none t-theme"
              style={{
                backgroundColor: '#FAFAF7',
                border: `1px solid ${error ? '#E8462A' : '#E4E0D9'}`,
                color: '#1A1917',
              }}
              autoFocus
            />
            {error && (
              <p className="text-[11px] mt-1" style={{ color: '#E8462A' }}>
                {error}
              </p>
            )}
          </div>

          <div>
            <label
              className="text-[11px] font-semibold uppercase tracking-wider block mb-1"
              style={{ color: '#6B6860' }}
            >
              Title (optional)
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="My Website"
              className="w-full px-3 py-2.5 rounded-md text-[14px] outline-none t-theme"
              style={{ backgroundColor: '#FAFAF7', border: '1px solid #E4E0D9', color: '#1A1917' }}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-md text-[13px] font-medium transition-colors"
              style={{ backgroundColor: '#EAE6DE', color: '#6B6860' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 rounded-md text-[13px] font-medium transition-colors flex items-center justify-center gap-1.5"
              style={{ backgroundColor: '#E8462A', color: '#FAFAF7' }}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Embed
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
