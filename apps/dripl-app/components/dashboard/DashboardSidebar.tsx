"use client";

import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { 
  LayoutGrid, 
  Folder, 
  Users, 
  Settings, 
  Plus,
  Search,
  ChevronDown
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";

export function DashboardSidebar() {
  const pathname = usePathname();

  const links = [
    { href: "/dashboard", label: "All Files", icon: LayoutGrid },
    { href: "/dashboard/folders", label: "Folders", icon: Folder },
    { href: "/dashboard/team", label: "Team", icon: Users },
    { href: "/dashboard/settings", label: "Settings", icon: Settings },
  ];

  return (
    <aside className="w-64 border-r bg-background flex flex-col h-screen">
      {/* Team Switcher */}
      <div className="p-4 border-b">
        <button className="flex items-center gap-2 w-full hover:bg-accent/50 p-2 rounded-lg transition-colors">
          <div className="w-8 h-8 rounded bg-indigo-600 flex items-center justify-center text-white font-bold">
            P
          </div>
          <div className="flex-1 text-left">
            <p className="text-sm font-medium">Pulkit's Team</p>
            <p className="text-xs text-muted-foreground">Free Plan</p>
          </div>
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        <div className="mb-4">
          <button className="w-full flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 transition-colors">
            <Plus className="w-4 h-4" />
            <span className="text-sm font-medium">New File</span>
          </button>
        </div>

        {links.map((link) => {
          const Icon = link.icon;
          const isActive = pathname === link.href;
          
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                isActive 
                  ? "bg-accent text-accent-foreground" 
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              <Icon className="w-4 h-4" />
              {link.label}
            </Link>
          );
        })}
      </nav>

      {/* User Profile */}
      <div className="p-4 border-t">
        <div className="flex items-center gap-3">
          <UserButton afterSignOutUrl="/" />
          <div className="flex-1">
            <p className="text-sm font-medium">My Account</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
