"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  LayoutGrid, 
  Clock, 
  User, 
  Folder, 
  HelpCircle, 
  Plus,
  Search,
  Settings
} from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { label: "All Files", icon: LayoutGrid, href: "/dashboard" },
  { label: "Recents", icon: Clock, href: "/dashboard/recents" },
  { label: "Created by Me", icon: User, href: "/dashboard/created" },
  { label: "Folders", icon: Folder, href: "/dashboard/folders" },
  { label: "Unsorted", icon: HelpCircle, href: "/dashboard/unsorted" },
];

export function DashboardSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 border-r border-white/10 bg-zinc-950 flex flex-col h-full">
      <div className="p-4">
        <div className="flex items-center gap-2 px-2 py-2 mb-6">
          <div className="h-6 w-6 rounded bg-indigo-500" />
          <span className="font-semibold text-white">Pulkit's Team</span>
        </div>

        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <input 
            type="text" 
            placeholder="Search" 
            className="w-full bg-zinc-900 border border-white/10 rounded-md py-2 pl-9 pr-4 text-sm text-white placeholder:text-zinc-500 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <nav className="space-y-1">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                pathname === item.href 
                  ? "bg-zinc-800 text-white" 
                  : "text-zinc-400 hover:text-white hover:bg-zinc-900"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="mt-auto p-4 border-t border-white/10">
        <div className="rounded-xl bg-zinc-900 p-4 mb-4 border border-white/5">
          <h3 className="font-medium text-white text-sm mb-1">Free Plan</h3>
          <div className="h-1.5 w-full bg-zinc-800 rounded-full mb-2 overflow-hidden">
            <div className="h-full bg-indigo-500 w-3/4" />
          </div>
          <p className="text-xs text-zinc-500 mb-3">3 of 3 files used</p>
          <button className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-md transition-colors">
            Upgrade
          </button>
        </div>
      </div>
    </aside>
  );
}
