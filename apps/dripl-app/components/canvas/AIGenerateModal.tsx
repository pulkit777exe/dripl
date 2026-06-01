'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkles, Loader2, AlertCircle } from 'lucide-react';
import { useCanvasStore } from '@/lib/canvas-store';
import { useAuth } from '@/app/context/AuthContext';
import type { DriplElement } from '@dripl/common';

interface AIGenerateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const EXAMPLE_PROMPTS = [
  'A flowchart showing user authentication flow',
  'A system architecture diagram with frontend, backend, and database',
  'An ER diagram for a blog with users, posts, and comments',
  'A decision tree for customer support',
  'A mind map about project management',
];

export function AIGenerateModal({ isOpen, onClose }: AIGenerateModalProps) {
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generateSuccess, setGenerateSuccess] = useState(false);

  const addElements = useCanvasStore(state => state.addElements);
  const setSelectedIds = useCanvasStore(state => state.setSelectedIds);
  const setActiveTool = useCanvasStore(state => state.setActiveTool);
  const { user } = useAuth();
  const successRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!generateSuccess || !successRef.current) return;
    const path = successRef.current.querySelector<SVGPathElement>('svg path');
    if (path && typeof path.getTotalLength === 'function') {
      const len = Math.ceil(path.getTotalLength());
      path.style.strokeDasharray = String(len);
      path.style.strokeDashoffset = String(len);
    }
  }, [generateSuccess]);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('Please enter a prompt');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          userId: user?.id || 'anonymous',
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate diagram');
      }

      if (data.elements && Array.isArray(data.elements)) {
        const generatedElements = data.elements as DriplElement[];
        addElements(generatedElements);
        setSelectedIds(new Set(generatedElements.map(element => element.id)));
        setActiveTool('select');
        setGenerateSuccess(true);
        setTimeout(() => {
          setGenerateSuccess(false);
          onClose();
          setPrompt('');
        }, 1200);
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExampleClick = (example: string) => {
    setPrompt(example);
    setError(null);
  };

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

  if (generateSuccess) {
    return createPortal(
      <div className="fixed inset-0 z-400 flex items-center justify-center bg-overlay backdrop-blur-sm t-modal is-open">
        <div className="bg-card border border-panel-border rounded-xl shadow-lg p-8 flex flex-col items-center gap-3">
          <span className="t-success-check" data-state="in" aria-hidden="true" ref={successRef}>
            <svg viewBox="0 0 48 48" fill="none" width="48" height="48">
              <circle cx="24" cy="24" r="22" stroke="#22c55e" strokeWidth="4" />
              <path d="M16 24l6 6 10-10" stroke="#22c55e" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <p className="text-[15px] font-semibold text-foreground">Diagram Generated!</p>
        </div>
      </div>,
      document.body
    );
  }

  if (!mounted || animState === 'closed') return null;

  const modalState = animState === 'open' ? 'is-open' : animState === 'closing' ? 'is-closing' : '';

  const modal = (
    <div
      className={`fixed inset-0 z-400 flex items-center justify-center p-4 box-content bg-overlay backdrop-blur-sm pointer-events-auto t-modal ${modalState}`}
      onClick={onClose}
    >
      <div
        className="bg-card border border-panel-border rounded-xl shadow-lg w-full max-w-115 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-panel-border">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-primary" />
            <h2 className="text-[15px] font-semibold text-foreground">AI Diagram Generator</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-muted-foreground">Describe your diagram</label>
            <textarea
              value={prompt}
              onChange={e => {
                setPrompt(e.target.value);
                setError(null);
              }}
              placeholder="e.g., A flowchart showing the checkout process for an e-commerce site"
              className="w-full h-28 px-3 py-2 bg-card border border-border rounded-md text-[13px] text-foreground placeholder:text-muted-foreground resize-none outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
              disabled={isLoading}
            />
            <div className="text-[11px] text-muted-foreground">{prompt.length}/2000</div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-muted-foreground">Try an example</label>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLE_PROMPTS.map((example, index) => (
                <button
                  key={index}
                  onClick={() => handleExampleClick(example)}
                  className="px-2.5 py-1 text-[11px] bg-card border border-border rounded-full text-muted-foreground hover:bg-secondary hover:border-primary transition-colors"
                  disabled={isLoading}
                >
                  {example.length > 40 ? example.slice(0, 40) + '...' : example}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 bg-error-bg border border-error-border rounded-md text-error text-[13px]">
              <AlertCircle size={14} />
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-panel-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={isLoading || !prompt.trim()}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-primary text-primary-foreground text-[13px] font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isLoading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles size={14} />
                Generate
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
