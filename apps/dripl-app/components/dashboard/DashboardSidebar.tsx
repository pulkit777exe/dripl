'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bookmark,
  FolderOpen,
  PenLine,
  Trash2,
  HelpCircle,
  Settings,
  LogOut,
  ChevronDown,
  Plus,
} from 'lucide-react';
import { ThemeToggle } from '../ThemeToggle';
import { useAuth } from '@/app/context/AuthContext';
import { useRouter } from 'next/navigation';

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

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  return (
    <aside className="w-[220px] flex flex-col h-full bg-[#FAFAF7] border-r border-[#E4E0D9]">
      {/* Workspace header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-7 w-7 rounded-md bg-[#E8462A] flex items-center justify-center">
            <PenLine className="h-3.5 w-3.5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-[#1A1917] truncate">
              {user?.name ? `${user.name}'s Workspace` : 'Workspace'}
            </p>
            <p className="text-[11px] text-[#9B9890]">Workspace</p>
          </div>
        </div>

        {/* New canvas button */}
        <button
          onClick={() => router.push('/canvas/new')}
          className="w-full flex items-center justify-center gap-1.5 rounded-md border border-[#D4D0C9] bg-white px-3 py-[6px] text-[13px] font-medium text-[#1A1917] transition-colors hover:bg-[#E8E5DE]"
        >
          <Plus className="h-3.5 w-3.5" />
          New canvas
        </button>
      </div>

      {/* Navigation */}
      <div className="px-3 flex-1">
        <p className="text-[11px] font-medium text-[#9B9890] uppercase tracking-wider px-2 mb-1.5">Main Menu</p>
        <nav className="space-y-0.5">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 px-2 py-[6px] rounded-md text-[13px] transition-colors ${
                  isActive
                    ? 'bg-[#FAE8E5] text-[#E8462A] font-medium'
                    : 'text-[#6B6860] hover:bg-[#E8E5DE] hover:text-[#1A1917]'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="flex-1">{item.label}</span>
                {item.count !== undefined && (
                  <span className={`text-[11px] rounded-full px-1.5 py-0.5 ${
                    isActive
                      ? 'bg-[#E8462A] text-white'
                      : 'bg-[#E8E5DE] text-[#6B6860]'
                  }`}>
                    {item.count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Bottom section */}
      <div className="px-3 pb-3 mt-auto">
        <p className="text-[11px] font-medium text-[#9B9890] uppercase tracking-wider px-2 mb-1.5">Support</p>
        <Link href="#" className="flex items-center gap-2 px-2 py-[6px] rounded-md text-[13px] text-[#6B6860] hover:bg-[#E8E5DE] hover:text-[#1A1917] transition-colors">
          <HelpCircle className="h-4 w-4" />
          Help
        </Link>
        <Link href="/settings/profile" className="flex items-center gap-2 px-2 py-[6px] rounded-md text-[13px] text-[#6B6860] hover:bg-[#E8E5DE] hover:text-[#1A1917] transition-colors">
          <Settings className="h-4 w-4" />
          Settings
        </Link>

        {/* User */}
        {user && (
          <div className="mt-3 pt-3 border-t border-[#E4E0D9]">
            <div className="flex items-center gap-2 px-1">
              <div className="w-7 h-7 rounded-full bg-[#E8E5DE] flex items-center justify-center border border-[#D4D0C9]">
                <span className="text-[11px] font-medium text-[#6B6860] uppercase">
                  {user.name?.[0] || user.email?.[0] || 'U'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium text-[#1A1917] truncate">{user.name || 'User'}</p>
                <p className="text-[11px] text-[#9B9890] truncate">{user.email}</p>
              </div>
              <button
                onClick={handleLogout}
                className="p-1 rounded-md text-[#9B9890] hover:text-[#C0392B] hover:bg-[#FAE8E5] transition-colors"
                title="Logout"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
