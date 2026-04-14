'use client';

import { useState } from 'react';
import { ArrowRight, PenLine } from 'lucide-react';

interface NameInputModalProps {
  onSubmit: (name: string) => void;
}

export function NameInputModal({ onSubmit }: NameInputModalProps) {
  const [name, setName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSubmit(name.trim());
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#FAFAF7] border border-[#E4E0D9] rounded-xl shadow-lg p-7 w-full max-w-sm mx-4 animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
        <div className="flex items-center gap-2 mb-4 justify-center">
          <div className="h-8 w-8 rounded-lg bg-[#E8462A] flex items-center justify-center text-white">
            <PenLine className="h-4 w-4" />
          </div>
        </div>
        <h2 className="text-[17px] font-semibold text-[#1A1917] text-center mb-1">Join the Canvas</h2>
        <p className="text-[13px] text-[#6B6860] text-center mb-5">Enter your name to start collaborating</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Your Name (e.g. Alice)"
            className="w-full px-3 py-2.5 rounded-md border border-[#D4D0C9] bg-white text-[14px] text-[#1A1917] outline-none transition-all placeholder:text-[#9B9890] focus:border-[#E8462A] focus:ring-1 focus:ring-[#E8462A]/20"
            autoFocus
          />

          <button
            type="submit"
            disabled={!name.trim()}
            className="w-full py-2.5 bg-[#E8462A] text-white rounded-md text-[13px] font-medium hover:bg-[#D93D22] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            Join Room
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
}
