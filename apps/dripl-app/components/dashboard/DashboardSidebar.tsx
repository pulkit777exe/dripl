'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutGrid,
  Clock,
  User,
  Folder,
  HelpCircle,
  Search,
  Plus,
  Settings,
  LogOut,
} from 'lucide-react';
import { ThemeToggle } from '../ThemeToggle';
import { useAuth } from '@/app/context/AuthContext';
import { useRouter } from 'next/navigation';

const items = [
  { label: 'All Files', icon: LayoutGrid, href: '/dashboard' },
  { label: 'Recents', icon: Clock, href: '/dashboard/recents' },
  { label: 'Created by Me', icon: User, href: '/dashboard/created' },
  { label: 'Folders', icon: Folder, href: '/dashboard/folders' },
  { label: 'Unsorted', icon: HelpCircle, href: '/dashboard/unsorted' },
];

export function DashboardSidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    await logout();
    router.push('/auth/login');
  };

  return (
    <aside className="w-64 bg-card border-r border-border flex flex-col h-full shadow-sm z-10 relative">
      <div className="p-4">
        <div className="flex items-center gap-2.5 px-2 py-1.5 mb-6">
          <div className="h-8 w-8 rounded-lg bg-linear-to-br from-primary to-primary/80 flex items-center justify-center shadow-md">
            <span className="text-primary-foreground font-bold text-sm">D</span>
          </div>
          <span className="font-semibold text-foreground text-lg tracking-tight">Dripl</span>
        </div>

        <button className="w-full flex items-center gap-2.5 px-3 py-2.5 mb-4 rounded-xl bg-primary/10 text-sm font-semibold text-primary hover:bg-primary hover:text-primary-foreground shadow-sm transition-all border border-primary/20">
          <Plus className="h-4 w-4" />
          New Canvas
        </button>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70" />
          <input
            type="text"
            placeholder="Search"
            className="w-full bg-secondary/40 border-0 rounded-lg py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:bg-secondary/60 transition-colors"
          />
        </div>

        <nav className="space-y-0.5">
          {items.map(item => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="mt-auto p-4 border-t border-border/50">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-muted-foreground">Appearance</span>
          <ThemeToggle />
        </div>

        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-muted-foreground">Settings</span>
          <button className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors">
            <Settings className="h-4 w-4" />
          </button>
        </div>

        {user && (
          <div className="flex items-center justify-between pt-3 border-t border-border/50">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                <span className="text-primary text-xs font-medium uppercase">
                  {user.name?.[0] || user.email?.[0] || 'U'}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-medium text-foreground truncate max-w-[100px]">
                  {user.name || user.email}
                </span>
                <span className="text-xs text-muted-foreground truncate max-w-[100px]">
                  {user.email}
                </span>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              title="Logout"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
