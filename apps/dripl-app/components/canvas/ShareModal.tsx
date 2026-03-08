"use client";

import { useEffect, useRef, useState } from "react";
import { X, Play, Link } from "lucide-react";
import * as QRCode from "qrcode";

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartSession?: () => void;
  onExportToLink?: (
    permission: "view" | "edit",
    expiresIn?: number,
  ) => Promise<string | null>;
}

export function ShareModal({
  isOpen,
  onClose,
  onStartSession,
  onExportToLink,
}: ShareModalProps) {
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [permission, setPermission] = useState<"view" | "edit">("view");
  const [expiry, setExpiry] = useState<number>(24);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!shareUrl || !qrCanvasRef.current) return;
    void QRCode.toCanvas(qrCanvasRef.current, shareUrl, {
      width: 160,
      margin: 1,
    });
  }, [shareUrl]);

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
    if (!onExportToLink) return;
    setIsExporting(true);
    try {
      const url = await onExportToLink(permission, expiry);
      setShareUrl(url);
    } finally {
      setIsExporting(false);
    }
  };

  const copyLink = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
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
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
        >
          <X size={20} />
        </button>

        <div className="text-center mb-8">
          <h2 className="text-xl font-semibold text-primary mb-2">
            Live collaboration
          </h2>
          <p className="text-sm text-muted-foreground mb-1">
            Invite people to <span className="text-primary">collaborate</span>{" "}
            on your drawing.
          </p>
          <p className="text-xs text-muted-foreground mb-6">
            Don&apos;t worry, the session is end-to-end encrypted and fully
            private. Not even our server can see what you draw.
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

        <div className="flex items-center gap-4 mb-6">
          <div className="flex-1 h-px bg-border" />
          <span className="text-sm text-muted-foreground">Or</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <div className="text-center">
          <h3 className="text-lg font-semibold text-primary mb-2">
            Shareable link
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            Configure permission and expiry for this board.
          </p>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <button
              className="px-3 py-2 rounded-lg border border-border text-sm"
              onClick={() => setPermission("view")}
            >
              View
            </button>
            <button
              className="px-3 py-2 rounded-lg border border-border text-sm"
              onClick={() => setPermission("edit")}
            >
              Edit
            </button>
          </div>

          <select
            className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm mb-4"
            value={expiry}
            onChange={(e) => setExpiry(Number(e.target.value))}
          >
            <option value={1}>Expires in 1 hour</option>
            <option value={24}>Expires in 24 hours</option>
            <option value={24 * 7}>Expires in 7 days</option>
            <option value={24 * 30}>Expires in 30 days</option>
          </select>

          <button
            onClick={handleExportToLink}
            disabled={isExporting}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-all transform hover:scale-105 disabled:opacity-50 disabled:transform-none shadow-lg"
          >
            <Link size={16} />
            {isExporting ? "Creating..." : "Create link"}
          </button>

          {shareUrl && (
            <div className="mt-4">
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  className="flex-1 px-3 py-2 rounded-lg border border-border bg-card text-xs"
                />
                <button
                  onClick={copyLink}
                  className="px-3 py-2 rounded-lg border border-border text-sm"
                >
                  Copy
                </button>
              </div>
              <div className="mt-3 flex justify-center">
                <canvas ref={qrCanvasRef} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
