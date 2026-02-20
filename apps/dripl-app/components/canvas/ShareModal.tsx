"use client";

import { useState } from "react";
import { X, Play, Link } from "lucide-react";

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartSession?: () => void;
  onExportToLink?: () => void;
}

export function ShareModal({
  isOpen,
  onClose,
  onStartSession,
  onExportToLink,
}: ShareModalProps) {
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  if (!isOpen) return null;

  const handleStartSession = async () => {
    setIsStartingSession(true);
    try {
      onStartSession?.();
    } finally {
      setIsStartingSession(false);
    }
  };

  const handleExportToLink = async () => {
    setIsExporting(true);
    try {
      onExportToLink?.();
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-300 flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-auto animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl shadow-2xl w-105 p-6 animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
        >
          <X size={20} />
        </button>

        {/* Live Collaboration Section */}
        <div className="text-center mb-8">
          <h2 className="text-xl font-semibold text-primary mb-2">
            Live collaboration
          </h2>
          <p className="text-sm text-muted-foreground mb-1">
            Invite people to <span className="text-primary">collaborate</span>{" "}
            on your drawing.
          </p>
          <p className="text-xs text-muted-foreground mb-6">
            Don't worry, the session is end-to-end encrypted and fully private.
            Not even our server can see what you draw.
          </p>

          <button
            onClick={handleStartSession}
            disabled={isStartingSession}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-all transform hover:scale-105 disabled:opacity-50 disabled:transform-none shadow-lg"
          >
            <Play size={16} fill="currentColor" />
            {isStartingSession ? "Starting..." : "Start session"}
          </button>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-4 mb-8">
          <div className="flex-1 h-px bg-border" />
          <span className="text-sm text-muted-foreground">Or</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Shareable Link Section */}
        <div className="text-center">
          <h3 className="text-lg font-semibold text-primary mb-2">
            Shareable link
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            Export as a read-only link.
          </p>

          <button
            onClick={handleExportToLink}
            disabled={isExporting}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-all transform hover:scale-105 disabled:opacity-50 disabled:transform-none shadow-lg"
          >
            <Link size={16} />
            {isExporting ? "Exporting..." : "Export to Link"}
          </button>
        </div>
      </div>
    </div>
  );
}
