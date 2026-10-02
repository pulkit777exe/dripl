'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkles, Loader2, AlertCircle, AlertTriangle } from 'lucide-react';
import { useCanvasStore } from '@/lib/store';
import { useModalAnimation } from '@/hooks/useModalAnimation';
import { DriplElementSchema, type DriplElement } from '@dripl/common';
import { z } from 'zod';

interface AIGenerateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MAX_PROMPT_LENGTH = 2_000;
const EXAMPLE_PROMPTS = [
  'A flowchart showing user authentication flow',
  'A system architecture diagram with frontend, backend, and database',
  'An ER diagram for a blog with users, posts, and comments',
  'A decision tree for customer support',
  'A mind map about project management',
];

const AIResponseSchema = z.object({
  elements: z.array(DriplElementSchema).min(1).max(100),
  warnings: z.array(z.string().max(500)).max(10).optional().default([]),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError') ||
    (isRecord(error) && error.name === 'AbortError')
  );
}

function errorMessageForResponse(status: number, payload: unknown): string {
  if (
    isRecord(payload) &&
    (payload.code === 'AI_INCOMPLETE' || payload.code === 'CONTENT_BLOCKED') &&
    typeof payload.error === 'string'
  ) {
    return payload.error;
  }
  if (status === 401) return 'Your session has expired. Sign in and try again.';
  if (status === 403) return 'This request is not allowed from the current site.';
  if (status === 429) {
    const retryAfter =
      isRecord(payload) && typeof payload.retryAfter === 'number' ? payload.retryAfter : null;
    return retryAfter && Number.isFinite(retryAfter)
      ? `AI generation is rate-limited. Try again in ${Math.max(1, Math.ceil(retryAfter))} seconds.`
      : 'AI generation is temporarily rate-limited. Please try again shortly.';
  }
  if (status === 502 || status === 503) {
    return 'The AI service is temporarily unavailable. Please try again.';
  }

  if (isRecord(payload) && typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error.trim().slice(0, 300);
  }
  return 'We could not generate a diagram. Please try again.';
}

export function AIGenerateModal({ isOpen, onClose }: AIGenerateModalProps) {
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [generateSuccess, setGenerateSuccess] = useState(false);

  const addElements = useCanvasStore(state => state.addElements);
  const setSelectedIds = useCanvasStore(state => state.setSelectedIds);
  const setActiveTool = useCanvasStore(state => state.setActiveTool);
  const readOnly = useCanvasStore(state => state.readOnly);
  const aiGenerating = useCanvasStore(s => s.aiGenerating);
  const setAiGenerating = useCanvasStore(s => s.setAiGenerating);
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!generateSuccess || !successRef.current) return;
    const path = successRef.current.querySelector<SVGPathElement>('svg path');
    if (path && typeof path.getTotalLength === 'function') {
      const len = Math.ceil(path.getTotalLength());
      path.style.strokeDasharray = String(len);
      path.style.strokeDashoffset = String(len);
    }
  }, [generateSuccess]);

  const clearSuccessTimer = useCallback(() => {
    if (successTimerRef.current !== null) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
  }, []);

  const cancelGeneration = useCallback(() => {
    abortRef.current?.abort();
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) {
      abortRef.current?.abort();
      clearSuccessTimer();
      return;
    }

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setGenerateSuccess(false);
    setError(null);
    setWarning(null);
    const focusFrame = window.requestAnimationFrame(() => dialogRef.current?.focus());

    return () => {
      window.cancelAnimationFrame(focusFrame);
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [clearSuccessTimer, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelGeneration();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [cancelGeneration, isOpen]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      clearSuccessTimer();
    };
  }, [clearSuccessTimer]);

  useEffect(() => {
    if (readOnly && isOpen) cancelGeneration();
  }, [cancelGeneration, isOpen, readOnly]);

  const handleGenerate = async () => {
    if (readOnly) {
      setError('This canvas is view-only.');
      return;
    }
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setError('Please enter a prompt');
      return;
    }
    if (trimmedPrompt.length > MAX_PROMPT_LENGTH) {
      setError(`Prompt is too long. Maximum ${MAX_PROMPT_LENGTH} characters.`);
      return;
    }
    if (aiGenerating || inFlightRef.current) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    inFlightRef.current = true;
    setAiGenerating(true);
    setError(null);
    setWarning(null);

    try {
      const response = await fetch('/api/ai/generate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: trimmedPrompt }),
        signal: abortRef.current.signal,
      });

      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(errorMessageForResponse(response.status, payload));
      }

      const parsed = AIResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error('The AI returned an invalid response. Please try again.');
      }

      const seenIds = new Set<string>();
      const generatedElements = (parsed.data.elements as DriplElement[]).filter(element => {
        if (seenIds.has(element.id)) return false;
        seenIds.add(element.id);
        return true;
      });
      if (generatedElements.length === 0) {
        throw new Error('No renderable elements were generated. Try rephrasing your prompt.');
      }

      const warnings = parsed.data.warnings;
      if (useCanvasStore.getState().readOnly) {
        throw new Error('This canvas is view-only.');
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
      clearSuccessTimer();
      successTimerRef.current = setTimeout(
        () => {
          successTimerRef.current = null;
          setGenerateSuccess(false);
          setWarning(null);
          onClose();
          setPrompt('');
        },
        warnings.length > 0 ? 2400 : 1200
      );
    } catch (caught: unknown) {
      if (isAbortError(caught)) return;
      setError(
        caught instanceof Error
          ? caught.message
          : 'We could not generate a diagram. Please try again.'
      );
    } finally {
      inFlightRef.current = false;
      setAiGenerating(false);
    }
  };

  const handleExampleClick = (example: string) => {
    setPrompt(example);
    setError(null);
    setWarning(null);
  };

  const { modalState, isVisible } = useModalAnimation(isOpen);

  if (generateSuccess) {
    return createPortal(
      <div
        className="fixed inset-0 z-400 flex items-center justify-center p-4 box-content backdrop-blur-sm pointer-events-auto t-modal is-open"
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)' }}
      >
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl shadow-lg p-8 flex flex-col items-center gap-3"
          style={{ backgroundColor: '#FAFAF7', border: '1px solid #E4E0D9' }}
        >
          <span className="t-success-check" data-state="in" aria-hidden="true" ref={successRef}>
            <svg viewBox="0 0 48 48" fill="none" width="48" height="48">
              <circle cx="24" cy="24" r="22" stroke="#22c55e" strokeWidth="4" />
              <path
                d="M16 24l6 6 10-10"
                stroke="#22c55e"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <p className="text-[15px] font-semibold" style={{ color: '#1A1917' }}>
            Diagram Generated!
          </p>
          {warning && (
            <div
              className="flex max-w-72 items-center gap-2 rounded-md px-3 py-2 text-[12px]"
              style={{
                border: '1px solid rgba(245, 158, 11, 0.4)',
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                color: '#b45309',
              }}
            >
              <AlertTriangle size={14} className="shrink-0" />
              <span>{warning}</span>
            </div>
          )}
        </div>
      </div>,
      document.body
    );
  }

  if (!isVisible) return null;

  const modal = (
    <div
      className={`fixed inset-0 z-400 flex items-center justify-center p-4 box-content backdrop-blur-sm pointer-events-auto t-modal ${modalState}`}
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)' }}
      onClick={cancelGeneration}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-dialog-title"
        tabIndex={-1}
        className="rounded-xl shadow-lg w-full max-w-115 max-h-[85vh] overflow-y-auto"
        style={{ backgroundColor: '#FAFAF7', border: '1px solid #E4E0D9' }}
        onClick={e => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-3.5"
          style={{ borderBottom: '1px solid #E4E0D9' }}
        >
          <div className="flex items-center gap-2">
            <Sparkles size={18} style={{ color: '#E8462A' }} />
            <h2
              id="ai-dialog-title"
              className="text-[15px] font-semibold"
              style={{ color: '#1A1917' }}
            >
              AI Diagram Generator
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close AI diagram generator"
            onClick={cancelGeneration}
            className="p-1 rounded-md transition-colors"
            style={{ color: '#6B6860' }}
            onMouseEnter={e => {
              e.currentTarget.style.color = '#1A1917';
              e.currentTarget.style.backgroundColor = '#E8E5DE';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = '#6B6860';
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="ai-prompt"
              className="text-[12px] font-medium"
              style={{ color: '#6B6860' }}
            >
              Describe your diagram
            </label>
            <textarea
              id="ai-prompt"
              value={prompt}
              onChange={e => {
                setPrompt(e.target.value);
                setError(null);
              }}
              placeholder="e.g., A flowchart showing the checkout process for an e-commerce site"
              className="w-full h-28 px-3 py-2 rounded-md text-[13px] resize-none outline-none"
              style={{ backgroundColor: '#FAFAF7', border: '1px solid #D4D0C9', color: '#1A1917' }}
              disabled={aiGenerating}
              maxLength={MAX_PROMPT_LENGTH}
              aria-label="Describe your diagram"
            />
            <div className="text-[11px]" style={{ color: '#6B6860' }}>
              {prompt.length}/{MAX_PROMPT_LENGTH}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium" style={{ color: '#6B6860' }}>
              Try an example
            </label>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLE_PROMPTS.map((example, index) => (
                <button
                  type="button"
                  key={index}
                  onClick={() => handleExampleClick(example)}
                  className="px-2.5 py-1 text-[11px] rounded-full transition-colors"
                  style={{
                    backgroundColor: '#FAFAF7',
                    border: '1px solid #D4D0C9',
                    color: '#6B6860',
                  }}
                  disabled={aiGenerating}
                >
                  {example.length > 40 ? example.slice(0, 40) + '...' : example}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div
              role="alert"
              aria-live="polite"
              className="flex items-center gap-2 px-3 py-2 rounded-md text-[13px]"
              style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA', color: '#B42318' }}
            >
              <AlertCircle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div
          className="flex justify-end gap-2 px-5 py-3.5"
          style={{ borderTop: '1px solid #E4E0D9' }}
        >
          <button
            type="button"
            onClick={cancelGeneration}
            className="px-3 py-1.5 text-[13px] transition-colors"
            style={{ color: '#6B6860' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={aiGenerating || !prompt.trim()}
            aria-busy={aiGenerating}
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
