"use client";

import { useState } from "react";
import { X, Sparkles, Loader2, AlertCircle } from "lucide-react";
import { useCanvasStore } from "@/lib/canvas-store";
import { useAuth } from "@/app/context/AuthContext";

interface AIGenerateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const EXAMPLE_PROMPTS = [
  "A flowchart showing user authentication flow",
  "A system architecture diagram with frontend, backend, and database",
  "An ER diagram for a blog with users, posts, and comments",
  "A decision tree for customer support",
  "A mind map about project management",
];

export function AIGenerateModal({ isOpen, onClose }: AIGenerateModalProps) {
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addElements = useCanvasStore((state) => state.addElements);
  const { user } = useAuth();

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError("Please enter a prompt");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          userId: user?.id || "anonymous",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate diagram");
      }

      if (data.elements && Array.isArray(data.elements)) {
        addElements(data.elements);
        onClose();
        setPrompt("");
      }
    } catch (err: any) {
      setError(err.message || "An error occurred");
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
      className="fixed inset-0 z-300 pt-100 flex items-center justify-center pointer-events-auto animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-[#232329] border border-[#333] rounded-2xl shadow-2xl w-[500px] max-h-[80vh] overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[#333]">
          <div className="flex items-center gap-2">
            <Sparkles size={20} className="text-[#6965db]" />
            <h2 className="text-lg font-semibold text-white">
              AI Diagram Generator
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white hover:bg-[#333] rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="space-y-2">
            <label className="text-sm text-gray-400">
              Describe your diagram
            </label>
            <textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setError(null);
              }}
              placeholder="e.g., A flowchart showing the checkout process for an e-commerce site"
              className="w-full h-32 p-3 bg-[#1a1a20] border border-[#333] rounded-lg text-white placeholder-gray-500 resize-none focus:outline-none focus:ring-2 focus:ring-[#6965db] focus:border-transparent"
              disabled={isLoading}
            />
            <div className="flex justify-between text-xs text-gray-500">
              <span>{prompt.length}/2000</span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-gray-400">Try an example</label>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_PROMPTS.map((example, index) => (
                <button
                  key={index}
                  onClick={() => handleExampleClick(example)}
                  className="px-3 py-1.5 text-xs bg-[#1a1a20] border border-[#333] rounded-full text-gray-300 hover:bg-[#2a2a3a] hover:border-[#6965db] transition-colors"
                  disabled={isLoading}
                >
                  {example.length > 40 ? example.slice(0, 40) + "..." : example}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
              <AlertCircle size={16} />
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 p-4 border-t border-[#333]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-300 hover:text-white transition-colors"
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={isLoading || !prompt.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-[#6965db] text-white font-medium rounded-lg hover:bg-[#5a56c7] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isLoading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles size={16} />
                Generate
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
