'use client';

import React from 'react';
import { X, AlertCircle } from 'lucide-react';

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
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-100 flex items-center justify-center p-4">
      <div
        className="w-full max-w-2xl bg-[#FAFAF7] rounded-xl border border-[#E4E0D9] shadow-lg max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center px-5 py-3.5 border-b border-[#E4E0D9]">
          <h2 className="text-[15px] font-semibold text-[#1A1917]">Load from link</h2>
          <button
            onClick={onClose}
            className="p-1 text-[#9B9890] hover:text-[#1A1917] hover:bg-[#E8E5DE] rounded-md transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Warning */}
        <div className="px-5 py-4 bg-[#FAE8E5] border-b border-[#E8462A]/15">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-[#E8462A]/15 flex items-center justify-center">
              <AlertCircle className="h-5 w-5 text-[#E8462A]" />
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-[#1A1917] mb-0.5">
                Loading external drawing will replace your existing content.
              </h3>
              <p className="text-[12px] text-[#6B6860]">
                You can back up your drawing first using one of the options below.
              </p>
            </div>
          </div>
        </div>

        {/* Backup Options */}
        <div className="p-5 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center">
              <h4 className="text-[14px] font-medium text-[#1A1917] mb-1">Export as image</h4>
              <p className="text-[12px] text-[#9B9890] mb-3">
                Export the scene data as an image from which you can import later.
              </p>
              <button
                onClick={onExportAsImage}
                className="w-full px-3 py-2 bg-white hover:bg-[#E8E5DE] text-[#1A1917] text-[13px] font-medium rounded-md border border-[#D4D0C9] transition-colors"
              >
                Export as image
              </button>
            </div>

            <div className="text-center">
              <h4 className="text-[14px] font-medium text-[#1A1917] mb-1">Save to disk</h4>
              <p className="text-[12px] text-[#9B9890] mb-3">
                Export the scene data to a file from which you can import later.
              </p>
              <button
                onClick={onSaveToDisk}
                className="w-full px-3 py-2 bg-white hover:bg-[#E8E5DE] text-[#1A1917] text-[13px] font-medium rounded-md border border-[#D4D0C9] transition-colors"
              >
                Save to disk
              </button>
            </div>

            <div className="text-center">
              <h4 className="text-[14px] font-medium text-[#1A1917] mb-1">Cloud backup</h4>
              <p className="text-[12px] text-[#9B9890] mb-3">
                Save the scene to your Dripl cloud workspace.
              </p>
              <button
                onClick={onExportToCloud}
                className="w-full px-3 py-2 bg-white hover:bg-[#E8E5DE] text-[#1A1917] text-[13px] font-medium rounded-md border border-[#D4D0C9] transition-colors"
              >
                Export to cloud
              </button>
            </div>
          </div>

          {/* Replace */}
          <div className="pt-4 border-t border-[#E4E0D9]">
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-[13px] text-[#6B6860] hover:text-[#1A1917] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={onReplaceContent}
                className="px-4 py-1.5 bg-[#E8462A] hover:bg-[#D93D22] text-white text-[13px] font-medium rounded-md transition-colors"
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
