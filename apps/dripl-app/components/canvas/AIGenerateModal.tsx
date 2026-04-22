'use client';

import { useState } from 'react';
import { X, Sparkles, Loader2, AlertCircle } from 'lucide-react';
import { useCanvasStore } from '@/lib/canvas-store';
import { useAuth } from '@/app/context/AuthContext';

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

  const addElements = useCanvasStore(state => state.addElements);
  const { user } = useAuth();

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
        addElements(data.elements);
        onClose();
        setPrompt('');
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

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/30 backdrop-blur-sm pointer-events-auto animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-[#FAFAF7] border border-[#E4E0D9] rounded-xl shadow-lg w-[480px] max-h-[80vh] overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300 mx-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E4E0D9]">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-[#E8462A]" />
            <h2 className="text-[15px] font-semibold text-[#1A1917]">AI Diagram Generator</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[#9B9890] hover:text-[#1A1917] hover:bg-[#E8E5DE] rounded-md transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-[#6B6860]">Describe your diagram</label>
            <textarea
              value={prompt}
              onChange={e => {
                setPrompt(e.target.value);
                setError(null);
              }}
              placeholder="e.g., A flowchart showing the checkout process for an e-commerce site"
              className="w-full h-28 px-3 py-2 bg-white border border-[#D4D0C9] rounded-md text-[13px] text-[#1A1917] placeholder-[#9B9890] resize-none outline-none focus:border-[#E8462A] focus:ring-1 focus:ring-[#E8462A]/20"
              disabled={isLoading}
            />
            <div className="text-[11px] text-[#9B9890]">{prompt.length}/2000</div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-[#6B6860]">Try an example</label>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLE_PROMPTS.map((example, index) => (
                <button
                  key={index}
                  onClick={() => handleExampleClick(example)}
                  className="px-2.5 py-1 text-[11px] bg-white border border-[#D4D0C9] rounded-full text-[#6B6860] hover:bg-[#E8E5DE] hover:border-[#E8462A] transition-colors"
                  disabled={isLoading}
                >
                  {example.length > 40 ? example.slice(0, 40) + '...' : example}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 bg-[#FAE8E5] border border-[#E8462A]/20 rounded-md text-[#C0392B] text-[13px]">
              <AlertCircle size={14} />
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-[#E4E0D9]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[13px] text-[#6B6860] hover:text-[#1A1917] transition-colors"
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={isLoading || !prompt.trim()}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-[#E8462A] text-white text-[13px] font-medium rounded-md hover:bg-[#D93D22] disabled:opacity-50 transition-colors"
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
}
