"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";

interface NameInputModalProps {
  onSubmit: (name: string) => void;
}

export function NameInputModal({ onSubmit }: NameInputModalProps) {
  const [name, setName] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSubmit(name.trim());
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background rounded-xl shadow-xl p-8 w-full max-w-md mx-4 animate-in zoom-in-95 duration-200">
        <h2 className="text-2xl font-bold mb-2 text-center text-slate-900">
          Join the Canvas
        </h2>
        <p className="text-slate-500 text-center mb-6">
          Enter your name to start collaborating
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your Name (e.g. Alice)"
            className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all placeholder:text-slate-400"
            autoFocus
          />

          <button
            type="submit"
            disabled={!name.trim()}
            className="w-full py-3 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            Join Room
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
