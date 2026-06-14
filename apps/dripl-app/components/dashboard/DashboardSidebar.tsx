'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Bookmark,
  FolderOpen,
  PenLine,
  Trash2,
  CreditCard,
  Bell,
  LogOut,
  Plus,
  ChevronsUpDown,
  Wallet,
  Settings,
  User2,
} from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import Image from 'next/image';
import { apiClient } from '@/lib/api';

const navItems = [
  { label: 'All Files', icon: Bookmark, href: '/dashboard', count: 0 },
  { label: 'Collections', icon: FolderOpen, href: '/dashboard/folders', count: 0 },
  { label: 'Canvas', icon: PenLine, href: '/dashboard/canvas' },
  { label: 'Trash', icon: Trash2, href: '/dashboard/trash' },
];

export function DashboardSidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const router = useRouter();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [usedCanvases, setUsedCanvases] = useState(0);
  const [usageLoading, setUsageLoading] = useState(false);
  const [closing, setClosing] = useState(false);
  const prevOpen = useRef(userMenuOpen);
  const FREE_PLAN_LIMIT = 3;

  useEffect(() => {
    if (!userMenuOpen && prevOpen.current) {
      prevOpen.current = false;
      setClosing(true);
    } else if (userMenuOpen) {
      setClosing(false);
      prevOpen.current = true;
    }
  }, [userMenuOpen]);

  useEffect(() => {
    if (!closing) return;
    const ms =
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--dropdown-close-dur'),
      ) || 150;
    const timer = setTimeout(() => setClosing(false), ms);
    return () => clearTimeout(timer);
  }, [closing]);

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  const loadPlanUsage = useCallback(async () => {
    if (!user) {
      setUsedCanvases(0);
      return;
    }
    setUsageLoading(true);
    try {
      const response = await apiClient.listFiles({ page: 1, limit: 1 });
      setUsedCanvases(response.total);
    } catch {
      // Keep previous count on transient failures.
    } finally {
      setUsageLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadPlanUsage();
    const handleFocus = () => {
      void loadPlanUsage();
    };
    const handleFilesChanged = () => {
      void loadPlanUsage();
    };
    window.addEventListener('focus', handleFocus);
    window.addEventListener('dripl:files-changed', handleFilesChanged as EventListener);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('dripl:files-changed', handleFilesChanged as EventListener);
    };
  }, [loadPlanUsage, pathname, user?.id]);

  const usagePercent = Math.min(100, Math.round((usedCanvases / FREE_PLAN_LIMIT) * 100));

  return (
    <aside className="w-60 flex flex-col h-full bg-[#F0EDE6] border-r border-[#E4E0D9]">
      {/* Workspace header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-3 p-2 mb-3 bg-[#FAFAF7] border border-[#E4E0D9] rounded-xl shadow-sm">
          <div className="relative h-8 w-8 rounded-lg overflow-hidden bg-white border border-[#E4E0D9] flex items-center justify-center">
            {user?.image ? (
              <Image
                src={user.image}
                alt={user.name || 'Workspace'}
                width={32}
                height={32}
                className="h-full w-full object-cover"
              />
            ) : (
              <Image
                src="/maple.png"
                alt="Workspace icon"
                fill
                sizes="32px"
                className="object-contain p-1"
              />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-[#1A1917] truncate">
              {user?.name ? `${user.name}'s Workspace` : "Pulkit's Workspace"}
            </p>
            <p className="text-[12px] text-[#6B6860]">Workspace</p>
          </div>
        </div>

        {/* New canvas button */}
        <button
          onClick={() => router.push('/canvas')}
          className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-[#E4E0D9] bg-[#FAFAF7] px-3 py-2 text-[13px] font-medium text-[#1A1917] transition-colors hover:bg-[#E8E5DE] shadow-sm"
        >
          <div className="flex items-center justify-center h-4 w-4 bg-[#9B9890]/20 rounded-sm">
            <Plus className="h-3 w-3 text-[#6B6860]" />
          </div>
          New canvas
        </button>

        <div className="mt-3 rounded-lg border border-[#E4E0D9] bg-[#FAFAF7] px-3 py-2 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-medium text-[#1A1917]">Free plan usage</p>
            <span className="text-[11px] text-[#6B6860]">
              {usageLoading ? '...' : `${usedCanvases}/${FREE_PLAN_LIMIT}`}
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-[#E8E5DE]">
            <div
              className="h-full rounded-full bg-[#E8462A] transition-all"
              style={{ width: `${usagePercent}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-[#6B6860]">
            Need more? Delete one canvas or upgrade.
          </p>
        </div>
      </div>

      {/* Navigation */}
      <div className="px-3 flex-1 mt-2">
        <p className="text-[11px] font-medium text-[#6B6860] px-3 mb-2">Main Menu</p>
        <nav className="space-y-1">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                  isActive
                    ? 'bg-[#E4E0D9] text-[#1A1917]'
                    : 'text-[#6B6860] hover:bg-[#E8E5DE] hover:text-[#1A1917]'
                }`}
              >
                <Icon className={`h-4.5 w-4.5 ${isActive ? 'text-[#1A1917]' : 'text-[#6B6860]'}`} />
                <span className="flex-1">{item.label}</span>
                {item.count !== undefined && (
                  <span
                    className={`text-[10px] rounded border border-[#C2BEB6] px-1.5 py-px ${
                      isActive ? 'bg-[#D4D0C9] text-[#1A1917]' : 'bg-[#D4D0C9] text-[#6B6860]'
                    }`}
                  >
                    {item.count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* User Card */}
      {user && (
        <div className="px-3 pb-4 mt-auto">
          <div
            className={`p-1.5 flex flex-col gap-1 rounded-xl border border-[#E4E0D9] bg-[#FAFAF7] shadow-sm transition-all`}
          >
            {/* Expanded Menu */}
            {(userMenuOpen || closing) && (
              <div
                className={`t-dropdown px-1.5 pt-1.5 pb-1 space-y-0.5 ${userMenuOpen ? 'is-open' : closing ? 'is-closing' : ''}`}
                data-origin="bottom-center"
              >
                <Link
                  href="/settings/profile"
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-medium text-[#6B6860] hover:bg-[#E8E5DE] transition-colors"
                >
                  <User2 className="w-4 h-4" />
                  Account
                </Link>
                <Link
                  href="/settings/billing"
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-medium text-[#6B6860] hover:bg-[#E8E5DE] transition-colors"
                >
                  <CreditCard className="w-4 h-4" />
                  Billing
                </Link>
                <Link
                  href="/settings/profile"
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-medium text-[#6B6860] hover:bg-[#E8E5DE] transition-colors"
                >
                  <Wallet className="w-4 h-4" />
                  Plans
                </Link>
                <Link
                  href="/settings/notifications"
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-medium text-[#6B6860] hover:bg-[#E8E5DE] transition-colors"
                >
                  <Bell className="w-4 h-4" />
                  Notifications
                </Link>
                <div className="my-1.5 mx-2 border-t border-[#E4E0D9]"></div>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-medium text-[#E8462A] hover:bg-[#FAE8E5] transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Log out
                </button>
                <div className="my-1.5 mx-2 border-t border-[#E4E0D9]"></div>
              </div>
            )}

            {/* Toggle Button */}
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="flex items-center gap-2.5 p-1.5 rounded-lg hover:bg-[#E8E5DE] transition-colors text-left"
            >
              <div className="h-8 w-8 rounded-lg bg-white border border-[#E4E0D9] flex items-center justify-center overflow-hidden">
                {user.image ? (
                  <Image
                    src={user.image}
                    alt={user.name || user.email || 'User'}
                    width={32}
                    height={32}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-[12px] font-medium text-[#6B6860] uppercase">
                    {user.name?.[0] || user.email?.[0] || 'U'}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-[#1A1917] truncate">
                  {user?.name || 'User'}
                </p>
                <p className="text-[12px] text-[#6B6860] truncate">{user?.email}</p>
              </div>
              <ChevronsUpDown className="w-3.5 h-3.5 text-[#6B6860] mx-1" />
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
