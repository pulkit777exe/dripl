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
      className="fixed inset-0 z-300 flex items-center justify-center bg-black/50 backdrop-blur-sm pointer-events-auto animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl shadow-xl w-120 p-6 animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
        >
          <X size={20} />
        </button>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-secondary/50 p-1 rounded-xl">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm font-medium transition-all ${
                  activeTab === tab.id
                    ? 'bg-background text-foreground shadow-button'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
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
          <div className="text-center py-6">
            <div className="w-20 h-20 bg-gradient-to-br from-primary/20 to-secondary rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-inner">
              <Play size={36} className="text-primary ml-1" />
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">Start live session</h2>
            <p className="text-muted-foreground mb-6">
              Collaborate in real-time with end-to-end encryption. No account required for
              participants.
            </p>
            <button
              onClick={handleStartSession}
              disabled={isStartingSession}
              className="inline-flex items-center gap-2 px-8 py-3 bg-primary text-primary-foreground font-medium rounded-xl hover:opacity-90 transition-all shadow-button hover:shadow-button-hover disabled:opacity-50 disabled:shadow-none"
            >
              <Play size={16} fill="currentColor" />
              {isStartingSession ? 'Starting...' : 'Start Session'}
            </button>
          </div>
        )}

        {/* Link Tab */}
        {activeTab === 'link' && (
          <div className="space-y-5">
            <div className="text-center">
              <h3 className="text-lg font-semibold text-foreground mb-2">Shareable Link</h3>
              <p className="text-sm text-muted-foreground">
                Create a shareable link with optional password protection.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                className={`px-4 py-3 rounded-xl border text-sm font-medium transition-all ${
                  permission === 'view'
                    ? 'border-primary bg-primary/10 text-primary shadow-inner'
                    : 'border-border hover:bg-secondary/50 text-foreground'
                }`}
                onClick={() => setPermission('view')}
              >
                View only
              </button>
              <button
                className={`px-4 py-3 rounded-xl border text-sm font-medium transition-all ${
                  permission === 'edit'
                    ? 'border-primary bg-primary/10 text-primary shadow-inner'
                    : 'border-border hover:bg-secondary/50 text-foreground'
                }`}
                onClick={() => setPermission('edit')}
              >
                Can edit
              </button>
            </div>

            <div className="flex items-center gap-2">
              <select
                className="flex-1 px-4 py-3 rounded-xl border border-border bg-background text-sm shadow-inner"
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

            <label className="flex items-center gap-3 text-sm cursor-pointer p-2 rounded-lg hover:bg-secondary/50 transition-colors">
              <input
                type="checkbox"
                checked={usePassword}
                onChange={e => setUsePassword(e.target.checked)}
                className="rounded border-border w-4 h-4"
              />
              <Lock size={16} className="text-muted-foreground" />
              <span className="text-foreground">Protect with password</span>
            </label>

            {usePassword && (
              <div className="relative">
                <Lock
                  size={16}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 rounded-xl border border-border bg-background text-sm shadow-inner focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            )}

            <button
              onClick={handleExportToLink}
              disabled={isExporting || (usePassword && !password)}
              className="w-full py-3 bg-primary text-primary-foreground font-medium rounded-xl hover:opacity-90 transition-all shadow-button hover:shadow-button-hover disabled:opacity-50"
            >
              {isExporting ? 'Creating...' : 'Create Link'}
            </button>

            {shareUrl && (
              <div className="mt-5 p-5 bg-secondary/30 rounded-xl border border-border shadow-inner">
                <div className="flex items-center gap-3 mb-4">
                  <input
                    readOnly
                    value={shareUrl}
                    className="flex-1 px-4 py-2.5 rounded-lg border border-border bg-background text-sm shadow-inner"
                  />
                  <button
                    onClick={copyLink}
                    className="p-2.5 rounded-lg border border-border hover:bg-accent transition-colors shadow-button"
                  >
                    {copied ? <Check size={18} className="text-green-600" /> : <Copy size={18} />}
                  </button>
                </div>
                <div className="flex justify-center">
                  <canvas ref={qrCanvasRef} className="rounded-lg shadow-md" />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Email Tab */}
        {activeTab === 'email' && (
          <div className="space-y-5">
            <div className="text-center">
              <h3 className="text-lg font-semibold text-foreground mb-2">Invite via Email</h3>
              <p className="text-sm text-muted-foreground">
                Send an invitation link directly to someone&apos;s inbox.
              </p>
            </div>

            <div className="relative">
              <Mail
                size={16}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="email"
                placeholder="email@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full pl-11 pr-4 py-3 rounded-xl border border-border bg-background text-sm shadow-inner focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                className={`px-4 py-3 rounded-xl border text-sm font-medium transition-all ${
                  permission === 'view'
                    ? 'border-primary bg-primary/10 text-primary shadow-inner'
                    : 'border-border hover:bg-secondary/50 text-foreground'
                }`}
                onClick={() => setPermission('view')}
              >
                View only
              </button>
              <button
                className={`px-4 py-3 rounded-xl border text-sm font-medium transition-all ${
                  permission === 'edit'
                    ? 'border-primary bg-primary/10 text-primary shadow-inner'
                    : 'border-border hover:bg-secondary/50 text-foreground'
                }`}
                onClick={() => setPermission('edit')}
              >
                Can edit
              </button>
            </div>

            <label className="flex items-center gap-3 text-sm cursor-pointer p-2 rounded-lg hover:bg-secondary/50 transition-colors">
              <input
                type="checkbox"
                checked={usePassword}
                onChange={e => setUsePassword(e.target.checked)}
                className="rounded border-border w-4 h-4"
              />
              <Lock size={14} className="text-muted-foreground" />
              <span className="text-foreground">Add password protection</span>
            </label>

            {usePassword && (
              <div className="relative">
                <Lock
                  size={16}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  type="password"
                  placeholder="Set a password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 rounded-xl border border-border bg-background text-sm shadow-inner focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            )}

            <button
              onClick={handleExportToLink}
              disabled={isExporting || !email || (usePassword && !password)}
              className="w-full py-3 bg-primary text-primary-foreground font-medium rounded-xl hover:opacity-90 transition-all shadow-button hover:shadow-button-hover disabled:opacity-50"
            >
              {isExporting ? 'Sending...' : 'Send Invite'}
            </button>

            {emailSent && (
              <div className="p-5 bg-green-500/10 border border-green-500/20 rounded-xl text-center shadow-inner">
                <Check size={28} className="mx-auto mb-2 text-green-600" />
                <p className="text-sm text-green-700 font-medium">Invitation sent to {email}!</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
