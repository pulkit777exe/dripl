'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, PenLine } from 'lucide-react';

interface NameInputModalProps {
  onSubmit: (name: string) => void;
}

export function NameInputModal({ onSubmit }: NameInputModalProps) {
  const [mounted, setMounted] = useState(false);
  const [animState, setAnimState] = useState<'opening' | 'open'>('opening');

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) {
      const raf = requestAnimationFrame(() => setAnimState('open'));
      return () => cancelAnimationFrame(raf);
    }
  }, [mounted]);

  const [name, setName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSubmit(name.trim());
    }
  };

  if (!mounted) return null;

  const modal = (
    <div
      className={`fixed inset-0 z-400 flex items-center justify-center p-4 box-content backdrop-blur-sm pointer-events-auto t-modal ${animState === 'open' ? 'is-open' : ''}`}
      style={{ backgroundColor: 'rgba(26, 25, 23, 0.6)' }}
    >
      <div className="rounded-xl shadow-lg p-7 w-full max-w-sm mx-4" style={{ backgroundColor: '#FAFAF7', border: '1px solid #E4E0D9' }}>
        <div className="flex items-center gap-2 mb-4 justify-center">
          <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#E8462A' }}>
            <PenLine className="h-4 w-4" style={{ color: '#FAFAF7' }} />
          </div>
        </div>
        <h2 className="text-[17px] font-semibold text-center mb-1" style={{ color: '#1A1917' }}>
          Join the Canvas
        </h2>
        <p className="text-[13px] text-center mb-5" style={{ color: '#6B6860' }}>
          Enter your name to start collaborating
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Your Name (e.g. Alice)"
            className="w-full px-3 py-2.5 rounded-md text-[14px] outline-none transition-all"
            style={{ backgroundColor: '#FAFAF7', border: '1px solid #E4E0D9', color: '#1A1917' }}
            autoFocus
          />

          <button
            type="submit"
            disabled={!name.trim()}
            className="w-full py-2.5 rounded-md text-[13px] font-medium transition-colors flex items-center justify-center gap-1.5"
            style={{ backgroundColor: '#E8462A', color: '#FAFAF7' }}
          >
            Join Room
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
