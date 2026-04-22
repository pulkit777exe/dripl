'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ChevronLeft,
  User,
  Lock,
  CreditCard,
  LogOut,
  Loader2,
  Check,
  Type,
  Settings,
  Bell,
} from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';

type SectionId = 'profile' | 'password' | 'font' | 'plan' | 'account';

const SECTION_NAV: Array<{
  id: SectionId;
  label: string;
  helper: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'profile', label: 'Account', helper: 'Profile and identity', icon: User },
  { id: 'password', label: 'Password', helper: 'Security settings', icon: Lock },
  { id: 'font', label: 'Font', helper: 'Canvas typography', icon: Type },
  { id: 'plan', label: 'Billing', helper: 'Plans and upgrade', icon: CreditCard },
  { id: 'account', label: 'Notifications', helper: 'Email and account', icon: Bell },
];

interface SectionCardProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

function SectionCard({ title, description, children }: SectionCardProps) {
  return (
    <section className="rounded-2xl border border-[#E4E0D9] bg-[#FAFAF7] p-6 shadow-sm">
      <header className="mb-5">
        <h2
          className="text-[24px] leading-tight text-[#10332B]"
          style={{ fontFamily: 'Georgia, serif' }}
        >
          {title}
        </h2>
        <p className="mt-1 text-[13px] text-[#6B6860]">{description}</p>
      </header>
      {children}
    </section>
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
      setTimeout(() => setSuccess(false), 1800);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SectionCard title="Account" description="Manage how your name appears across Dripl.">
      <div className="space-y-4">
        <div>
          <label className="block text-[12px] font-medium text-[#6B6860] mb-1.5">
            What should Dripl call you?
          </label>
          <input
            type="text"
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder="Your name"
            className="w-full max-w-md rounded-xl border border-[#D4D0C9] bg-white px-4 py-2.5 text-[18px] text-[#10332B] focus:outline-none focus:border-[#0E6655]"
          />
        </div>

        <p className="text-[12px] text-[#9B9890]">{user?.email ?? 'No email available'}</p>

        <button
          onClick={handleSave}
          disabled={loading || name === (user?.name || '')}
          className="inline-flex items-center gap-2 rounded-xl border border-[#D4D0C9] bg-[#FAFAF7] px-4 py-2 text-[13px] font-medium text-[#1A1917] hover:bg-[#E8E5DE] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading && <Loader2 className="size-4 animate-spin" />}
          {success && <Check className="size-4 text-[#0E6655]" />}
          {success ? 'Saved' : 'Save changes'}
        </button>
      </div>
    </SectionCard>
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
      setError('New password must be at least 8 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await changePassword(currentPassword, newPassword);
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setSuccess(false), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SectionCard title="Password" description="Update your password to keep your account secure.">
      <div className="grid gap-4 max-w-lg">
        <div>
          <label className="block text-[12px] font-medium text-[#6B6860] mb-1.5">
            Current password
          </label>
          <input
            type="password"
            value={currentPassword}
            onChange={event => setCurrentPassword(event.target.value)}
            placeholder="Enter current password"
            className="w-full rounded-xl border border-[#D4D0C9] bg-white px-3 py-2 text-[13px] text-[#1A1917] focus:outline-none focus:border-[#0E6655]"
          />
        </div>

        <div>
          <label className="block text-[12px] font-medium text-[#6B6860] mb-1.5">
            New password
          </label>
          <input
            type="password"
            value={newPassword}
            onChange={event => setNewPassword(event.target.value)}
            placeholder="Minimum 8 characters"
            className="w-full rounded-xl border border-[#D4D0C9] bg-white px-3 py-2 text-[13px] text-[#1A1917] focus:outline-none focus:border-[#0E6655]"
          />
        </div>

        <div>
          <label className="block text-[12px] font-medium text-[#6B6860] mb-1.5">
            Confirm new password
          </label>
          <input
            type="password"
            value={confirmPassword}
            onChange={event => setConfirmPassword(event.target.value)}
            placeholder="Confirm password"
            className="w-full rounded-xl border border-[#D4D0C9] bg-white px-3 py-2 text-[13px] text-[#1A1917] focus:outline-none focus:border-[#0E6655]"
          />
        </div>

        {error && <p className="text-[12px] text-[#C0392B]">{error}</p>}
        {success && <p className="text-[12px] text-[#0E6655]">Password changed successfully.</p>}

        <button
          onClick={handleChange}
          disabled={loading || !currentPassword || !newPassword || !confirmPassword}
          className="inline-flex w-fit items-center gap-2 rounded-xl bg-[#10332B] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#0C2821] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading && <Loader2 className="size-4 animate-spin" />}
          {success && <Check className="size-4" />}
          {success ? 'Changed' : 'Change password'}
        </button>
      </div>
    </SectionCard>
  );
}

const FONT_OPTIONS = [
  {
    id: 'handwritten',
    name: 'Caveat (Handwritten)',
    preview: 'Aa Bb Cc',
    family: 'Caveat, cursive',
  },
  { id: 'sans', name: 'Inter (Clean)', preview: 'Aa Bb Cc', family: 'Inter, sans-serif' },
  { id: 'serif', name: 'Georgia (Classic)', preview: 'Aa Bb Cc', family: 'Georgia, serif' },
  { id: 'mono', name: 'Monospace (Code)', preview: 'Aa Bb Cc', family: 'monospace' },
];

function FontPreferencesSettings() {
  const [selectedFont, setSelectedFont] = useState(
    () =>
      (typeof window !== 'undefined' ? window.localStorage.getItem('dripl_canvas_font') : null) ||
      'handwritten'
  );
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    setSuccess(false);
    try {
      localStorage.setItem('dripl_canvas_font', selectedFont);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 1800);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SectionCard title="Font Preferences" description="Pick your default canvas text style.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FONT_OPTIONS.map(font => (
          <button
            key={font.id}
            onClick={() => setSelectedFont(font.id)}
            className={`rounded-xl border p-3 text-left transition-colors ${
              selectedFont === font.id
                ? 'border-[#0E6655] bg-[#E6F2EF]'
                : 'border-[#E4E0D9] bg-white hover:border-[#D4D0C9]'
            }`}
          >
            <p className="text-[14px] font-medium text-[#1A1917]">{font.name}</p>
            <p className="mt-1 text-[20px] text-[#6B6860]" style={{ fontFamily: font.family }}>
              {font.preview}
            </p>
          </button>
        ))}
      </div>

      <button
        onClick={handleSave}
        disabled={loading}
        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#10332B] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#0C2821] transition-colors disabled:opacity-50"
      >
        {loading && <Loader2 className="size-4 animate-spin" />}
        {success && <Check className="size-4" />}
        {success ? 'Saved' : 'Save preferences'}
      </button>
    </SectionCard>
  );
}

function PlanSettings() {
  return (
    <SectionCard title="Billing" description="Manage your current plan and upgrades.">
      <div className="space-y-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#D4D0C9] bg-[#E8E5DE] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#6B6860]">
          Free plan
        </div>
        <p className="text-[13px] text-[#6B6860] max-w-xl">
          You are currently on the free plan. Upgrade to unlock team workspaces, unlimited canvases,
          and advanced collaboration controls.
        </p>
        <button className="rounded-xl bg-[#E8462A] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#D93D22] transition-colors">
          Upgrade to Pro
        </button>
      </div>
    </SectionCard>
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
    <SectionCard title="Notifications" description="Account identity and session controls.">
      <div className="space-y-4">
        <div className="rounded-xl border border-[#E4E0D9] bg-white p-4">
          <p className="text-[12px] font-medium text-[#6B6860]">Email</p>
          <p className="mt-1 text-[14px] text-[#1A1917]">{user?.email ?? 'No email available'}</p>
        </div>

        <div className="rounded-xl border border-[#E4E0D9] bg-white p-4">
          <p className="text-[12px] font-medium text-[#6B6860]">Account type</p>
          <p className="mt-1 text-[14px] text-[#1A1917]">Email / Google</p>
        </div>

        <button
          onClick={handleLogout}
          className="inline-flex items-center gap-2 rounded-xl border border-[#F0B7A9] bg-[#FAE8E5] px-4 py-2 text-[13px] font-medium text-[#C0392B] hover:bg-[#F6D8D2] transition-colors"
        >
          <LogOut className="size-4" />
          Log out
        </button>
      </div>
    </SectionCard>
  );
}

function renderSection(section: SectionId) {
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
}

export default function SettingsPage() {
  const router = useRouter();
  const params = useParams<{ section?: string }>();
  const { user, loading, logout } = useAuth();

  const section = useMemo<SectionId>(() => {
    const candidate = params?.section;
    if (candidate === 'profile') return 'profile';
    if (candidate === 'password') return 'password';
    if (candidate === 'font') return 'font';
    if (candidate === 'plan' || candidate === 'billing') return 'plan';
    if (candidate === 'account' || candidate === 'notifications') return 'account';
    return 'profile';
  }, [params?.section]);

  const activeNav = SECTION_NAV.find(item => item.id === section) ?? SECTION_NAV[0] ?? { id: 'profile', label: 'Profile', icon: User };

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-[#F0EDE6]">
        <Loader2 className="size-6 animate-spin text-[#0E6655]" />
      </div>
    );
  }

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  return (
    <div className="flex h-dvh bg-[#F0EDE6] overflow-hidden">
      <aside className="w-[280px] border-r border-[#E4E0D9] bg-[#EDE9DF] flex flex-col">
        <div className="px-5 pt-5">
          <button
            onClick={() => router.push('/dashboard')}
            className="inline-flex items-center gap-2 text-[14px] font-medium text-[#0E6655] hover:text-[#0A4A3D] transition-colors"
          >
            <ChevronLeft className="size-4" />
            Back to dashboard
          </button>
        </div>

        <div className="px-5 pt-7 pb-5 border-b border-[#D8D2C8]">
          <h2
            className="text-[42px] leading-none text-[#10332B]"
            style={{ fontFamily: 'Georgia, serif' }}
          >
            {user?.name || 'Account'}
          </h2>
          <p
            className="mt-3 text-[22px] leading-none text-[#A7A195]"
            style={{ fontFamily: 'Georgia, serif' }}
          >
            Settings
          </p>
          <p className="mt-4 text-[15px] text-[#6B6860] break-all">
            {user?.email ?? 'No email connected'}
          </p>
          <p className="mt-1 text-[13px] text-[#9B9890]">Workspace preferences</p>
        </div>

        <nav className="px-3 py-4 space-y-1.5">
          {SECTION_NAV.map(item => {
            const isActive = item.id === section;
            const Icon = item.icon;

            return (
              <button
                key={item.id}
                onClick={() => router.push(`/settings/${item.id}`)}
                className={`w-full rounded-xl px-3 py-2.5 text-left transition-colors ${
                  isActive ? 'bg-[#DCD5C8] text-[#1A1917]' : 'text-[#6B6860] hover:bg-[#E6DFD3]'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className="size-4" />
                  <span className="text-[14px] font-medium">{item.label}</span>
                </div>
                <p className={`mt-1 text-[11px] ${isActive ? 'text-[#4A4741]' : 'text-[#9B9890]'}`}>
                  {item.helper}
                </p>
              </button>
            );
          })}
        </nav>

        <div className="mt-auto px-3 pb-4">
          <button
            onClick={handleLogout}
            className="w-full rounded-xl border border-[#F0B7A9] bg-[#FAE8E5] px-3 py-2.5 text-[13px] font-medium text-[#C0392B] hover:bg-[#F6D8D2] transition-colors inline-flex items-center gap-2"
          >
            <LogOut className="size-4" />
            Log out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-8 py-10 sm:px-12">
          <header className="mb-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#D4D0C9] bg-[#FAFAF7] px-3 py-1 text-[12px] text-[#6B6860]">
              <Settings className="size-3.5" />
              {activeNav.label}
            </div>
          </header>

          {renderSection(section)}
        </div>
      </main>
    </div>
  );
}
