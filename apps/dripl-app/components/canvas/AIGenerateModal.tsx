'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkles, Loader2, AlertCircle, AlertTriangle } from 'lucide-react';
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
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [generateSuccess, setGenerateSuccess] = useState(false);

  const addElements = useCanvasStore(state => state.addElements);
  const setSelectedIds = useCanvasStore(state => state.setSelectedIds);
  const setActiveTool = useCanvasStore(state => state.setActiveTool);
  const aiGenerating = useCanvasStore(s => s.aiGenerating);
  const setAiGenerating = useCanvasStore(s => s.setAiGenerating);
  const abortRef = useRef<AbortController | null>(null);
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
    if (aiGenerating) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setAiGenerating(true);
    setError(null);
    setWarning(null);

    try {
      const response = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          userId: user?.id || 'anonymous',
        }),
        signal: abortRef.current.signal,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate diagram');
      }

      if (data.elements && Array.isArray(data.elements)) {
        const generatedElements = data.elements as DriplElement[];
        const warnings = Array.isArray(data.warnings)
          ? data.warnings.filter((item: unknown): item is string => typeof item === 'string')
          : [];

        if (generatedElements.length === 0) {
          throw new Error('No renderable elements were generated. Try rephrasing your prompt.');
        }

        addElements(generatedElements);
        setSelectedIds(new Set(generatedElements.map(element => element.id)));
        setActiveTool('select');
        window.dispatchEvent(
          new CustomEvent('dripl:fit-elements', {
            detail: { elementIds: generatedElements.map(element => element.id) },
          })
        );
        setWarning(warnings[0] ?? null);
        setGenerateSuccess(true);
        setTimeout(() => {
          setGenerateSuccess(false);
          setWarning(null);
          onClose();
          setPrompt('');
        }, warnings.length > 0 ? 2400 : 1200);
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
    } finally {
      setAiGenerating(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    return () => {
      abortRef.current?.abort();
    };
  }, [isOpen]);

  const handleExampleClick = (example: string) => {
    setPrompt(example);
    setError(null);
    setWarning(null);
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
      <div className="fixed inset-0 z-400 flex items-center justify-center p-4 box-content backdrop-blur-sm pointer-events-auto t-modal is-open" style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)' }}>
        <div className="rounded-xl shadow-lg p-8 flex flex-col items-center gap-3" style={{ backgroundColor: '#FAFAF7', border: '1px solid #E4E0D9' }}>
          <span className="t-success-check" data-state="in" aria-hidden="true" ref={successRef}>
            <svg viewBox="0 0 48 48" fill="none" width="48" height="48">
              <circle cx="24" cy="24" r="22" stroke="#22c55e" strokeWidth="4" />
              <path d="M16 24l6 6 10-10" stroke="#22c55e" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <p className="text-[15px] font-semibold" style={{ color: '#1A1917' }}>Diagram Generated!</p>
          {warning && (
            <div className="flex max-w-72 items-center gap-2 rounded-md px-3 py-2 text-[12px]" style={{ border: '1px solid rgba(245, 158, 11, 0.4)', backgroundColor: 'rgba(245, 158, 11, 0.1)', color: '#b45309' }}>
              <AlertTriangle size={14} className="shrink-0" />
              <span>{warning}</span>
            </div>
          )}
        </div>
      </div>,
      document.body
    );
  }

  if (!mounted || animState === 'closed') return null;

  const modalState = animState === 'open' ? 'is-open' : animState === 'closing' ? 'is-closing' : '';

  const modal = (
    <div
      className={`fixed inset-0 z-400 flex items-center justify-center p-4 box-content backdrop-blur-sm pointer-events-auto t-modal ${modalState}`}
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)' }}
      onClick={onClose}
    >
      <div
        className="rounded-xl shadow-lg w-full max-w-115 max-h-[85vh] overflow-y-auto"
        style={{ backgroundColor: '#FAFAF7', border: '1px solid #E4E0D9' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid #E4E0D9' }}>
          <div className="flex items-center gap-2">
            <Sparkles size={18} style={{ color: '#E8462A' }} />
            <h2 className="text-[15px] font-semibold" style={{ color: '#1A1917' }}>AI Diagram Generator</h2>
          </div>
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

        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium" style={{ color: '#6B6860' }}>Describe your diagram</label>
            <textarea
              value={prompt}
              onChange={e => {
                setPrompt(e.target.value);
                setError(null);
              }}
              placeholder="e.g., A flowchart showing the checkout process for an e-commerce site"
              className="w-full h-28 px-3 py-2 rounded-md text-[13px] resize-none outline-none"
              style={{ backgroundColor: '#FAFAF7', border: '1px solid #D4D0C9', color: '#1A1917' }}
              disabled={aiGenerating}
            />
            <div className="text-[11px]" style={{ color: '#6B6860' }}>{prompt.length}/2000</div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium" style={{ color: '#6B6860' }}>Try an example</label>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLE_PROMPTS.map((example, index) => (
                <button
                  key={index}
                  onClick={() => handleExampleClick(example)}
                  className="px-2.5 py-1 text-[11px] rounded-full transition-colors"
                  style={{ backgroundColor: '#FAFAF7', border: '1px solid #D4D0C9', color: '#6B6860' }}
                  disabled={aiGenerating}
                >
                  {example.length > 40 ? example.slice(0, 40) + '...' : example}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md text-[13px]" style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA', color: '#B42318' }}>
              <AlertCircle size={14} />
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3.5" style={{ borderTop: '1px solid #E4E0D9' }}>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[13px] transition-colors"
            style={{ color: '#6B6860' }}
            disabled={aiGenerating}
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={aiGenerating || !prompt.trim()}
            className="flex items-center gap-1.5 px-4 py-1.5 text-[13px] font-medium rounded-md transition-colors"
            style={{ backgroundColor: '#E8462A', color: '#ffffff' }}
          >
            {aiGenerating ? (
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
