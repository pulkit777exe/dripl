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

  const inputClass =
    'w-full rounded-md border border-[#D4D0C9] bg-white px-3 py-2 text-[13px] text-[#1A1917] outline-none transition-all placeholder:text-[#9B9890] focus:border-[#E8462A] focus:ring-1 focus:ring-[#E8462A]/20';

  return (
    <div
      className="fixed inset-0 z-300 flex items-center justify-center bg-black/30 backdrop-blur-sm pointer-events-auto animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-[#FAFAF7] border border-[#E4E0D9] rounded-xl shadow-lg w-[440px] p-5 animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-[#9B9890] hover:text-[#1A1917] hover:bg-[#E8E5DE] rounded-md transition-colors"
        >
          <X size={18} />
        </button>

        {/* Tabs */}
        <div className="flex gap-0.5 mb-5 rounded-md border border-[#D4D0C9] bg-white p-0.5">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded text-[12px] font-medium transition-all ${
                  activeTab === tab.id
                    ? 'bg-[#E8E5DE] text-[#1A1917]'
                    : 'text-[#9B9890] hover:text-[#1A1917]'
                }`}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Session Tab */}
        {activeTab === 'session' && (
          <div className="text-center py-6">
            <div className="w-16 h-16 bg-[#FAE8E5] rounded-xl flex items-center justify-center mx-auto mb-4">
              <Play size={28} className="text-[#E8462A] ml-0.5" />
            </div>
            <h2 className="text-[15px] font-semibold text-[#1A1917] mb-1">Start live session</h2>
            <p className="text-[13px] text-[#6B6860] mb-5 max-w-xs mx-auto">
              Collaborate in real-time with end-to-end encryption. No account required for participants.
            </p>
            <button
              onClick={handleStartSession}
              disabled={isStartingSession}
              className="inline-flex items-center gap-2 px-5 py-2 bg-[#E8462A] text-white text-[13px] font-medium rounded-md hover:bg-[#D93D22] transition-colors disabled:opacity-50"
            >
              <Play size={14} fill="currentColor" />
              {isStartingSession ? 'Starting...' : 'Start Session'}
            </button>
          </div>
        )}

        {/* Link Tab */}
        {activeTab === 'link' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-[14px] font-semibold text-[#1A1917] mb-1">Shareable Link</h3>
              <p className="text-[12px] text-[#9B9890]">Create a shareable link with optional password protection.</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                className={`px-3 py-2 rounded-md border text-[12px] font-medium transition-all ${
                  permission === 'view'
                    ? 'border-[#E8462A] bg-[#FAE8E5] text-[#E8462A]'
                    : 'border-[#D4D0C9] hover:bg-[#E8E5DE] text-[#6B6860]'
                }`}
                onClick={() => setPermission('view')}
              >
                View only
              </button>
              <button
                className={`px-3 py-2 rounded-md border text-[12px] font-medium transition-all ${
                  permission === 'edit'
                    ? 'border-[#E8462A] bg-[#FAE8E5] text-[#E8462A]'
                    : 'border-[#D4D0C9] hover:bg-[#E8E5DE] text-[#6B6860]'
                }`}
                onClick={() => setPermission('edit')}
              >
                Can edit
              </button>
            </div>

            <select
              className={inputClass}
              value={expiry}
              onChange={e => setExpiry(Number(e.target.value))}
            >
              <option value={1}>Expires in 1 hour</option>
              <option value={24}>Expires in 24 hours</option>
              <option value={24 * 7}>Expires in 7 days</option>
              <option value={24 * 30}>Expires in 30 days</option>
              <option value={-1}>Never expires</option>
            </select>

            <label className="flex items-center gap-2 text-[13px] cursor-pointer py-1 text-[#6B6860]">
              <input
                type="checkbox"
                checked={usePassword}
                onChange={e => setUsePassword(e.target.checked)}
                className="rounded border-[#D4D0C9] w-3.5 h-3.5 accent-[#E8462A]"
              />
              <Lock size={14} />
              Protect with password
            </label>

            {usePassword && (
              <input
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className={inputClass}
              />
            )}

            <button
              onClick={handleExportToLink}
              disabled={isExporting || (usePassword && !password)}
              className="w-full py-2 bg-[#E8462A] text-white text-[13px] font-medium rounded-md hover:bg-[#D93D22] transition-colors disabled:opacity-50"
            >
              {isExporting ? 'Creating...' : 'Create Link'}
            </button>

            {shareUrl && (
              <div className="p-4 bg-white rounded-lg border border-[#E4E0D9]">
                <div className="flex items-center gap-2 mb-3">
                  <input
                    readOnly
                    value={shareUrl}
                    className="flex-1 px-3 py-1.5 rounded-md border border-[#D4D0C9] bg-[#F0EDE6] text-[12px] text-[#6B6860]"
                  />
                  <button
                    onClick={copyLink}
                    className="p-1.5 rounded-md border border-[#D4D0C9] hover:bg-[#E8E5DE] transition-colors"
                  >
                    {copied ? <Check size={16} className="text-green-600" /> : <Copy size={16} className="text-[#6B6860]" />}
                  </button>
                </div>
                <div className="flex justify-center">
                  <canvas ref={qrCanvasRef} className="rounded-md" />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Email Tab */}
        {activeTab === 'email' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-[14px] font-semibold text-[#1A1917] mb-1">Invite via Email</h3>
              <p className="text-[12px] text-[#9B9890]">Send an invitation link directly to someone&apos;s inbox.</p>
            </div>

            <input
              type="email"
              placeholder="email@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className={inputClass}
            />

            <div className="grid grid-cols-2 gap-2">
              <button
                className={`px-3 py-2 rounded-md border text-[12px] font-medium transition-all ${
                  permission === 'view'
                    ? 'border-[#E8462A] bg-[#FAE8E5] text-[#E8462A]'
                    : 'border-[#D4D0C9] hover:bg-[#E8E5DE] text-[#6B6860]'
                }`}
                onClick={() => setPermission('view')}
              >
                View only
              </button>
              <button
                className={`px-3 py-2 rounded-md border text-[12px] font-medium transition-all ${
                  permission === 'edit'
                    ? 'border-[#E8462A] bg-[#FAE8E5] text-[#E8462A]'
                    : 'border-[#D4D0C9] hover:bg-[#E8E5DE] text-[#6B6860]'
                }`}
                onClick={() => setPermission('edit')}
              >
                Can edit
              </button>
            </div>

            <label className="flex items-center gap-2 text-[13px] cursor-pointer py-1 text-[#6B6860]">
              <input
                type="checkbox"
                checked={usePassword}
                onChange={e => setUsePassword(e.target.checked)}
                className="rounded border-[#D4D0C9] w-3.5 h-3.5 accent-[#E8462A]"
              />
              <Lock size={14} />
              Add password protection
            </label>

            {usePassword && (
              <input
                type="password"
                placeholder="Set a password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className={inputClass}
              />
            )}

            <button
              onClick={handleExportToLink}
              disabled={isExporting || !email || (usePassword && !password)}
              className="w-full py-2 bg-[#E8462A] text-white text-[13px] font-medium rounded-md hover:bg-[#D93D22] transition-colors disabled:opacity-50"
            >
              {isExporting ? 'Sending...' : 'Send Invite'}
            </button>

            {emailSent && (
              <div className="p-4 bg-[#E8F5E9] border border-[#A5D6A7] rounded-lg text-center">
                <Check size={24} className="mx-auto mb-1 text-green-600" />
                <p className="text-[13px] text-green-700 font-medium">Invitation sent to {email}!</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
