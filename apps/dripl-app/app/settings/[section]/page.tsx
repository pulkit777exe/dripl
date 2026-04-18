'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ChevronLeft, Settings, User, Lock, CreditCard, LogOut, Loader2, Check, Type
} from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';

interface SettingSectionProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

function SettingSection({ title, description, children }: SettingSectionProps) {
  return (
    <div className="mb-8">
      <div className="mb-3">
        <p className="text-[12px] font-semibold text-[#6B6860] uppercase tracking-wide">{title}</p>
        <p className="text-[12px] text-[#9B988F]">{description}</p>
      </div>
      <div className="bg-[#FAFAF7] border border-[#E4E0D9] rounded-xl p-5 shadow-sm">
        {children}
      </div>
    </div>
  );
}

function ProfileSettings() {
  const { user, updateProfile, refreshUser } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    setSuccess(false);
    try {
      await updateProfile(name || undefined);
      await refreshUser();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SettingSection title="Profile" description="Your public profile information">
      <div className="flex items-start gap-5">
        <div className="relative size-14 rounded-full bg-[#E8E5DE] flex items-center justify-center text-[#6B6860] font-semibold text-xl">
          {user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'U'}
        </div>
        <div className="flex-1 space-y-4">
          <div>
            <label className="text-[12px] font-medium text-[#6B6860] block mb-1.5">Display name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your name"
              className="w-full h-9 rounded-md border border-[#E4E0D9] bg-white px-3 text-[13px] text-[#1A1917] placeholder:text-[#9B988F] focus:outline-none focus:border-[#E8462A]"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={loading || name === (user?.name || '')}
              className="flex items-center gap-2 px-4 py-2 rounded-md bg-[#E8462A] text-white text-[13px] font-medium hover:bg-[#D6302A] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading && <Loader2 className="size-3.5 animate-spin" />}
              {success && <Check className="size-3.5" />}
              {success ? 'Saved' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </SettingSection>
  );
}

function PasswordSettings() {
  const { changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleChange = async () => {
    setError('');
    
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }
    
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await changePassword(currentPassword, newPassword);
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SettingSection title="Password" description="Change your account password">
      <div className="space-y-4 max-w-sm">
        <div>
          <label className="text-[12px] font-medium text-[#6B6860] block mb-1.5">Current password</label>
          <input
            type="password"
            value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)}
            placeholder="Enter current password"
            className="w-full h-9 rounded-md border border-[#E4E0D9] bg-white px-3 text-[13px] text-[#1A1917] placeholder:text-[#9B988F] focus:outline-none focus:border-[#E8462A]"
          />
        </div>
        <div>
          <label className="text-[12px] font-medium text-[#6B6860] block mb-1.5">New password</label>
          <input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            placeholder="Min 8 characters"
            className="w-full h-9 rounded-md border border-[#E4E0D9] bg-white px-3 text-[13px] text-[#1A1917] placeholder:text-[#9B988F] focus:outline-none focus:border-[#E8462A]"
          />
        </div>
        <div>
          <label className="text-[12px] font-medium text-[#6B6860] block mb-1.5">Confirm new password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            className="w-full h-9 rounded-md border border-[#E4E0D9] bg-white px-3 text-[13px] text-[#1A1917] placeholder:text-[#9B988F] focus:outline-none focus:border-[#E8462A]"
          />
        </div>
        {error && (
          <p className="text-[12px] text-[#E8462A]">{error}</p>
        )}
        {success && (
          <p className="text-[12px] text-[#2F9E44]">Password changed successfully</p>
        )}
        <button
          onClick={handleChange}
          disabled={loading || !currentPassword || !newPassword || !confirmPassword}
          className="flex items-center gap-2 px-4 py-2 rounded-md bg-[#E8462A] text-white text-[13px] font-medium hover:bg-[#D6302A] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading && <Loader2 className="size-3.5 animate-spin" />}
          {success && <Check className="size-3.5" />}
          {success ? 'Changed' : 'Change password'}
        </button>
      </div>
    </SettingSection>
  );
}

function PlanSettings() {
  const [plan] = useState('free');

  return (
    <SettingSection title="Plan" description="Manage your subscription plan">
      <div className="flex items-start gap-5">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-4">
            <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide ${plan === 'pro' ? 'bg-[#E8462A] text-white' : 'bg-[#E8E5DE] text-[#6B6860]'}`}>
              {plan === 'pro' ? 'Pro' : 'Free'}
            </span>
            <span className="text-[13px] text-[#1A1917] font-medium">Free Plan</span>
          </div>
          <p className="text-[12px] text-[#6B6860] mb-4">
            You are currently on the free plan. Upgrade to Pro for unlimited canvases, custom branding, and more.
          </p>
          <button className="px-4 py-2 rounded-md bg-[#1A1917] text-white text-[13px] font-medium hover:bg-[#3A3937] transition-colors">
            Upgrade to Pro
          </button>
        </div>
      </div>
    </SettingSection>
  );
}

function AccountSettings() {
  const router = useRouter();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  return (
    <SettingSection title="Account" description="Manage your account">
      <div className="space-y-4">
        <div className="flex items-center justify-between py-2">
          <div>
            <p className="text-[13px] text-[#1A1917] font-medium">Email</p>
            <p className="text-[12px] text-[#6B6860]">{user?.email}</p>
          </div>
        </div>
        <div className="flex items-center justify-between py-2 border-t border-[#E4E0D9]">
          <div>
            <p className="text-[13px] text-[#1A1917] font-medium">Account type</p>
            <p className="text-[12px] text-[#6B6860]">Email / Google</p>
          </div>
        </div>
        <div className="pt-2">
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 rounded-md text-[13px] font-medium text-[#E8462A] bg-[#FAE8E5] hover:bg-[#E8462A] hover:text-white transition-colors"
          >
            <LogOut className="size-4" />
            Log out
          </button>
        </div>
      </div>
    </SettingSection>
  );
}

const FONT_OPTIONS = [
  { id: 'handwritten', name: 'Caveat (Handwritten)', preview: 'Aa Bb Cc', family: 'Caveat, cursive' },
  { id: 'sans', name: 'Inter (Clean)', preview: 'Aa Bb Cc', family: 'Inter, sans-serif' },
  { id: 'serif', name: 'Georgia (Classic)', preview: 'Aa Bb Cc', family: 'Georgia, serif' },
  { id: 'mono', name: 'Monospace (Code)', preview: 'Aa Bb Cc', family: 'monospace' },
];

function FontPreferencesSettings() {
  const [selectedFont, setSelectedFont] = useState('handwritten');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    setSuccess(false);
    try {
      localStorage.setItem('dripl_canvas_font', selectedFont);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } finally {
      setLoading(false);
    }
  };

  const currentFont = FONT_OPTIONS.find(f => f.id === selectedFont);

  return (
    <SettingSection title="Font Preferences" description="Choose your preferred font for canvas text">
      <div className="space-y-4">
        <p className="text-[12px] text-[#6B6860]">
          Select the default font used for text elements on your canvas.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {FONT_OPTIONS.map(font => (
            <button
              key={font.id}
              onClick={() => setSelectedFont(font.id)}
              className={`p-4 rounded-lg border text-left transition-all ${
                selectedFont === font.id
                  ? 'border-[#E8462A] bg-[#FAE8E5]'
                  : 'border-[#E4E0D9] hover:border-[#D4D0C9]'
              }`}
            >
              <p className="text-[14px] font-medium text-[#1A1917] mb-1">{font.name}</p>
              <p className="text-[18px] text-[#6B6860]" style={{ fontFamily: font.family }}>
                {font.preview}
              </p>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 pt-2">
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-md bg-[#E8462A] text-white text-[13px] font-medium hover:bg-[#D6302A] transition-colors disabled:opacity-50"
          >
            {loading && <Loader2 className="size-3.5 animate-spin" />}
            {success && <Check className="size-3.5" />}
            {success ? 'Saved' : 'Save preferences'}
          </button>
        </div>
      </div>
    </SettingSection>
  );
}

function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const section = searchParams.get('section') || 'profile';

  const renderSection = () => {
    switch (section) {
      case 'profile':
        return <ProfileSettings />;
      case 'password':
        return <PasswordSettings />;
      case 'font':
        return <FontPreferencesSettings />;
      case 'plan':
        return <PlanSettings />;
      case 'account':
        return <AccountSettings />;
      default:
        return <ProfileSettings />;
    }
  };

  const navItems = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'password', label: 'Password', icon: Lock },
    { id: 'font', label: 'Font', icon: Type },
    { id: 'plan', label: 'Plan', icon: CreditCard },
    { id: 'account', label: 'Account', icon: User },
  ];

  return (
    <div className="flex h-dvh bg-[#F0EDE6] overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 bg-[#FAFAF7] border-r border-[#E4E0D9] flex flex-col">
        <div className="p-4 border-b border-[#E4E0D9]">
          <div className="flex items-center gap-2 text-[#1A1917]">
            <Settings className="size-4" />
            <span className="text-[14px] font-semibold">Settings</span>
          </div>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => router.push('/settings/' + item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-colors ${
                section === item.id
                  ? 'bg-[#E8E5DE] text-[#1A1917]'
                  : 'text-[#6B6860] hover:bg-[#F0EDE6] hover:text-[#1A1917]'
              }`}
            >
              <item.icon className="size-4" />
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-auto">
        <div className="flex items-center gap-4 border-b border-[#E4E0D9] bg-[#FAFAF7] px-6 py-3">
          <button onClick={() => router.back()} className="p-1 rounded-md text-[#6B6860] hover:text-[#1A1917] hover:bg-[#E8E5DE] transition-colors">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-[#6B6860]" />
            <h1 className="text-[14px] font-semibold text-[#1A1917]">
              {navItems.find(s => s.id === section)?.label || 'Settings'}
            </h1>
          </div>
        </div>

        <div className="max-w-2xl px-10 py-8 mx-auto w-full">
          {renderSection()}
        </div>
      </main>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={
      <div className="flex h-dvh items-center justify-center bg-[#F0EDE6]">
        <Loader2 className="size-6 animate-spin text-[#E8462A]" />
      </div>
    }>
      <SettingsContent />
    </Suspense>
  );
}