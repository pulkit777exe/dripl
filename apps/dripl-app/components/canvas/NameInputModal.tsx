'use client';

import { useState, useEffect, useRef } from 'react';
import { ArrowRight, PenLine } from 'lucide-react';

interface NameInputModalProps {
  onSubmit: (name: string) => void;
}

export function NameInputModal({ onSubmit }: NameInputModalProps) {
  const [animState, setAnimState] = useState<'opening' | 'open'>('opening');
  useEffect(() => {
    const raf = requestAnimationFrame(() => setAnimState('open'));
    return () => cancelAnimationFrame(raf);
  }, []);

  const [name, setName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSubmit(name.trim());
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-sm t-modal ${animState === 'open' ? 'is-open' : ''}">
      <div className="bg-card border border-panel-border rounded-xl shadow-lg p-7 w-full max-w-sm mx-4">
        <div className="flex items-center gap-2 mb-4 justify-center">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground">
            <PenLine className="h-4 w-4" />
          </div>
        </div>
        <h2 className="text-[17px] font-semibold text-foreground text-center mb-1">
          Join the Canvas
        </h2>
        <p className="text-[13px] text-muted-foreground text-center mb-5">
          Enter your name to start collaborating
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Your Name (e.g. Alice)"
            className="w-full px-3 py-2.5 rounded-md border border-border bg-card text-[14px] text-foreground outline-none transition-all placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary/20"
            autoFocus
          />

          <button
            type="submit"
            disabled={!name.trim()}
            className="w-full py-2.5 bg-primary text-primary-foreground rounded-md text-[13px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            Join Room
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
}
