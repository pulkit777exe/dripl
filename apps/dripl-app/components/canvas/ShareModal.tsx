'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Play, Link, Mail, Lock, Copy, Check } from 'lucide-react';
import * as QRCode from 'qrcode';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartSession?: () => void;
  onExportToLink?: (
    permission: 'view' | 'edit',
    expiresIn?: number,
    password?: string,
    email?: string
  ) => Promise<string | null>;
}

type TabType = 'session' | 'link' | 'email';

export function ShareModal({ isOpen, onClose, onStartSession, onExportToLink }: ShareModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('session');
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [permission, setPermission] = useState<'view' | 'edit'>('view');
  const [expiry, setExpiry] = useState<number>(24);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!shareUrl || !qrCanvasRef.current) return;
    void QRCode.toCanvas(qrCanvasRef.current, shareUrl, {
      width: 160,
      margin: 1,
    });
  }, [shareUrl]);

  useEffect(() => {
    if (!isOpen) {
      setShareUrl(null);
      setEmailSent(false);
      setEmail('');
      setPassword('');
      setUsePassword(false);
    }
  }, [isOpen]);

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
      const url = await onExportToLink(
        permission,
        expiry,
        usePassword ? password : undefined,
        email || undefined
      );
      setShareUrl(url);
      if (email && usePassword) {
        setEmailSent(true);
      }
    } finally {
      setIsExporting(false);
    }
  };

  const copyLink = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const tabs = [
    { id: 'session' as TabType, label: 'Live Session', icon: Play },
    { id: 'link' as TabType, label: 'Share Link', icon: Link },
    { id: 'email' as TabType, label: 'Email Invite', icon: Mail },
  ];

  return (
    <div
      className="fixed inset-0 z-300 flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-auto animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl shadow-2xl w-120 p-6 animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
        >
          <X size={20} />
        </button>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-muted p-1 rounded-lg">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Session Tab */}
        {activeTab === 'session' && (
          <div className="text-center py-4">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Play size={32} className="text-primary" />
            </div>
            <h2 className="text-xl font-semibold text-primary mb-2">Start live session</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Collaborate in real-time with end-to-end encryption. No account required for
              participants.
            </p>
            <button
              onClick={handleStartSession}
              disabled={isStartingSession}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-all transform hover:scale-105 disabled:opacity-50 disabled:transform-none shadow-lg"
            >
              <Play size={16} fill="currentColor" />
              {isStartingSession ? 'Starting...' : 'Start Session'}
            </button>
          </div>
        )}

        {/* Link Tab */}
        {activeTab === 'link' && (
          <div className="space-y-4">
            <div className="text-center">
              <h3 className="text-lg font-semibold text-primary mb-2">Shareable Link</h3>
              <p className="text-sm text-muted-foreground">
                Create a shareable link with optional password protection.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                className={`px-3 py-2 rounded-lg border text-sm transition-colors ${
                  permission === 'view'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:bg-accent'
                }`}
                onClick={() => setPermission('view')}
              >
                View only
              </button>
              <button
                className={`px-3 py-2 rounded-lg border text-sm transition-colors ${
                  permission === 'edit'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:bg-accent'
                }`}
                onClick={() => setPermission('edit')}
              >
                Can edit
              </button>
            </div>

            <div className="flex items-center gap-2">
              <select
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-card text-sm"
                value={expiry}
                onChange={e => setExpiry(Number(e.target.value))}
              >
                <option value={1}>Expires in 1 hour</option>
                <option value={24}>Expires in 24 hours</option>
                <option value={24 * 7}>Expires in 7 days</option>
                <option value={24 * 30}>Expires in 30 days</option>
                <option value={-1}>Never expires</option>
              </select>
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={usePassword}
                onChange={e => setUsePassword(e.target.checked)}
                className="rounded border-border"
              />
              <Lock size={14} />
              Protect with password
            </label>

            {usePassword && (
              <div className="relative">
                <Lock
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 rounded-lg border border-border bg-card text-sm"
                />
              </div>
            )}

            <button
              onClick={handleExportToLink}
              disabled={isExporting || (usePassword && !password)}
              className="w-full py-2.5 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {isExporting ? 'Creating...' : 'Create Link'}
            </button>

            {shareUrl && (
              <div className="mt-4 p-4 bg-muted rounded-lg">
                <div className="flex items-center gap-2 mb-3">
                  <input
                    readOnly
                    value={shareUrl}
                    className="flex-1 px-3 py-2 rounded border border-border bg-background text-xs"
                  />
                  <button
                    onClick={copyLink}
                    className="p-2 rounded border border-border hover:bg-accent transition-colors"
                  >
                    {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
                  </button>
                </div>
                <div className="flex justify-center">
                  <canvas ref={qrCanvasRef} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Email Tab */}
        {activeTab === 'email' && (
          <div className="space-y-4">
            <div className="text-center">
              <h3 className="text-lg font-semibold text-primary mb-2">Invite via Email</h3>
              <p className="text-sm text-muted-foreground">
                Send an invitation link directly to someone&apos;s inbox.
              </p>
            </div>

            <div className="relative">
              <Mail
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="email"
                placeholder="email@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full pl-10 pr-3 py-2 rounded-lg border border-border bg-card text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                className={`px-3 py-2 rounded-lg border text-sm transition-colors ${
                  permission === 'view'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:bg-accent'
                }`}
                onClick={() => setPermission('view')}
              >
                View only
              </button>
              <button
                className={`px-3 py-2 rounded-lg border text-sm transition-colors ${
                  permission === 'edit'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:bg-accent'
                }`}
                onClick={() => setPermission('edit')}
              >
                Can edit
              </button>
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={usePassword}
                onChange={e => setUsePassword(e.target.checked)}
                className="rounded border-border"
              />
              <Lock size={14} />
              Add password protection
            </label>

            {usePassword && (
              <div className="relative">
                <Lock
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  type="password"
                  placeholder="Set a password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 rounded-lg border border-border bg-card text-sm"
                />
              </div>
            )}

            <button
              onClick={handleExportToLink}
              disabled={isExporting || !email || (usePassword && !password)}
              className="w-full py-2.5 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {isExporting ? 'Sending...' : 'Send Invite'}
            </button>

            {emailSent && (
              <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg text-center">
                <Check size={24} className="mx-auto mb-2 text-green-500" />
                <p className="text-sm text-green-600 font-medium">Invitation sent to {email}!</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
