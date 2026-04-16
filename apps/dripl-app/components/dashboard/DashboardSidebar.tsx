'use client';

import { useState } from 'react';
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
} from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import Image from 'next/image';

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

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  return (
    <aside className="w-[240px] flex flex-col h-full bg-[#F0EDE6] border-r border-[#E4E0D9]">
      {/* Workspace header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-3 p-2 mb-3 bg-[#FAFAF7] border border-[#E4E0D9] rounded-xl shadow-sm">
          <div className="relative h-8 w-8 rounded-lg overflow-hidden bg-white border border-[#E4E0D9] flex items-center justify-center p-1">
            <Image
              src="/maple.png"
              alt="Workspace icon"
              fill
              className="object-contain p-1"
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-[#1A1917] truncate">
              {user?.name ? `${user.name}'s Workspace` : 'Pulkit\'s Workspace'}
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
                className={`flex items-center gap-2.5 px-3 py-[6px] rounded-lg text-[13px] font-medium transition-colors ${
                  isActive
                    ? 'bg-[#E4E0D9] text-[#1A1917]'
                    : 'text-[#6B6860] hover:bg-[#E8E5DE] hover:text-[#1A1917]'
                }`}
              >
                <Icon className={`h-[18px] w-[18px] ${isActive ? 'text-[#1A1917]' : 'text-[#6B6860]'}`} />
                <span className="flex-1">{item.label}</span>
                {item.count !== undefined && (
                  <span className={`text-[10px] rounded border border-[#C2BEB6] px-1.5 py-px ${
                    isActive
                      ? 'bg-[#D4D0C9] text-[#1A1917]'
                      : 'bg-[#D4D0C9] text-[#6B6860]'
                  }`}>
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
          <div className={`p-1.5 flex flex-col gap-1 rounded-xl border border-[#E4E0D9] bg-[#FAFAF7] shadow-sm transition-all`}>
            {/* Expanded Menu */}
            {userMenuOpen && (
              <div className="px-1.5 pt-1.5 pb-1 space-y-0.5 animate-in fade-in slide-in-from-bottom-2 duration-200">
                <Link href="/settings/billing" className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-medium text-[#6B6860] hover:bg-[#E8E5DE] transition-colors">
                  <CreditCard className="w-4 h-4" />
                  Billing
                </Link>
                <Link href="/settings/profile" className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-medium text-[#6B6860] hover:bg-[#E8E5DE] transition-colors">
                  <Wallet className="w-4 h-4" />
                  Plans
                </Link>
                <Link href="/settings/notifications" className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-medium text-[#6B6860] hover:bg-[#E8E5DE] transition-colors">
                  <Bell className="w-4 h-4" />
                  Notifications
                </Link>
                <div className="my-1.5 mx-2 border-t border-[#E4E0D9]"></div>
                <button onClick={handleLogout} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-medium text-[#E8462A] hover:bg-[#FAE8E5] transition-colors">
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
              <div className="h-8 w-8 rounded-lg bg-white border border-[#E4E0D9] flex items-center justify-center text-[12px] font-semibold text-[#1A1917] overflow-hidden">
                {/* Fallback to initials since image might not exist */}
				<span className="text-[12px] font-medium text-[#6B6860] uppercase">
                  {user.name?.[0] || user.email?.[0] || 'U'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-[#1A1917] truncate">{user?.name || 'User'}</p>
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
