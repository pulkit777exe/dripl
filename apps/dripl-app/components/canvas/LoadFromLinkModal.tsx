"use client";

import React from "react";

interface LoadFromLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReplaceContent: () => void;
  onExportAsImage: () => void;
  onSaveToDisk: () => void;
  onExportToCloud: () => void;
}

export function LoadFromLinkModal({
  isOpen,
  onClose,
  onReplaceContent,
  onExportAsImage,
  onSaveToDisk,
  onExportToCloud,
}: LoadFromLinkModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-100 flex items-center justify-center p-4">
      <div
        className="w-full max-w-2xl bg-[#232329] rounded-xl border border-[#3f3f46] shadow-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-[#3f3f46]">
          <h2 className="text-xl font-semibold text-white flex items-center gap-3">
            Load from link
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:bg-gray-700 rounded-full transition-colors"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Warning Message */}
        <div className="p-6 bg-[#ff6b6b]/10 border-b border-[#ff6b6b]/20">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-12 h-12 rounded-full bg-[#ff6b6b]/20 flex items-center justify-center">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#ff6b6b"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-white mb-2">
                Loading external drawing will replace your existing content.
              </h3>
              <p className="text-gray-400">
                You can back up your drawing first using one of the options below.
              </p>
            </div>
          </div>
        </div>

        {/* Backup Options */}
        <div className="p-6 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Export as Image */}
            <div className="text-center">
              <h4 className="text-lg font-medium text-white mb-2">
                Export as image
              </h4>
              <p className="text-sm text-gray-400 mb-4">
                Export the scene data as an image from which you can import later.
              </p>
              <button
                onClick={onExportAsImage}
                className="w-full px-4 py-2 bg-[#2a2a3a] hover:bg-[#3a3a4a] text-white rounded-lg border border-[#3f3f46] transition-colors"
              >
                Export as image
              </button>
            </div>

            {/* Save to Disk */}
            <div className="text-center">
              <h4 className="text-lg font-medium text-white mb-2">
                Save to disk
              </h4>
              <p className="text-sm text-gray-400 mb-4">
                Export the scene data to a file from which you can import later.
              </p>
              <button
                onClick={onSaveToDisk}
                className="w-full px-4 py-2 bg-[#2a2a3a] hover:bg-[#3a3a4a] text-white rounded-lg border border-[#3f3f46] transition-colors"
              >
                Save to disk
              </button>
            </div>

            {/* Export to Cloud */}
            <div className="text-center">
              <h4 className="text-lg font-medium text-white mb-2">
                Excalidraw+
              </h4>
              <p className="text-sm text-gray-400 mb-4">
                Save the scene to your Excalidraw+ workspace.
              </p>
              <button
                onClick={onExportToCloud}
                className="w-full px-4 py-2 bg-[#2a2a3a] hover:bg-[#3a3a4a] text-white rounded-lg border border-[#3f3f46] transition-colors"
              >
                Export to Excalidraw+
              </button>
            </div>
          </div>

          {/* Replace Button */}
          <div className="pt-6 border-t border-[#3f3f46]">
            <div className="flex justify-end gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={onReplaceContent}
                className="px-6 py-2 bg-[#8b5cf6] hover:bg-[#7c3aed] text-white rounded-lg font-medium transition-colors"
              >
                Replace my content
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
