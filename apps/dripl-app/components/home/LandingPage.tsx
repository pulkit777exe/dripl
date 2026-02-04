"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import {
  Search,
  Home,
  CheckSquare,
  Inbox,
  Calendar,
  Users,
  FileText,
  Layers,
  Plus,
  Clock,
  MoreHorizontal,
  LucideIcon,
} from "lucide-react";
import { getAllCanvasRooms, CanvasRoomData } from "@/lib/canvas-db";

export function LandingPage() {
  const router = useRouter();
  const [roomId, setRoomId] = useState("");
  const [recentRooms, setRecentRooms] = useState<CanvasRoomData[]>([]);

  useEffect(() => {
    // Load recent rooms
    getAllCanvasRooms().then((rooms) => {
      const sorted = rooms.sort((a, b) => b.lastModified - a.lastModified);
      setRecentRooms(sorted);
    });
  }, []);

  const handleCreateRoom = () => {
    const newRoomId = uuidv4();
    router.push(`/canvas/${newRoomId}`);
  };

  return (
    <div className="flex h-dvh bg-background text-foreground font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-[280px] flex flex-col p-4 border-r border-border">
        {/* Brand */}
        <div className="flex items-center gap-3 px-3 py-4 mb-6">
          <div className="w-8 h-8 bg-linear-to-br from-foreground/20 to-foreground/5 rounded-lg flex items-center justify-center border border-foreground/10 shadow-inner">
            <Layers className="w-5 h-5 text-foreground" />
          </div>
          <span className="font-semibold text-lg tracking-tight">Dripl</span>
          <div className="ml-auto">
            <div className="w-6 h-6 flex items-center justify-center rounded hover:bg-accent cursor-pointer text-muted-foreground">
              <MoreHorizontal className="w-4 h-4" />
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="px-1 mb-6">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-foreground transition-colors" />
            <input
              type="text"
              placeholder="Search"
              className="w-full bg-card border border-transparent focus:border-foreground/10 text-sm text-foreground placeholder:text-muted-foreground rounded-xl py-2.5 pl-10 pr-10 outline-none transition-all focus:bg-accent"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded bg-accent text-[10px] text-muted-foreground font-medium border border-foreground/5">
              /
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1">
          <NavItem icon={Home} label="Dashboard" />
          <NavItem
            icon={CheckSquare}
            label="Tasks"
            active
            count={recentRooms.length}
          />
          <NavItem icon={Inbox} label="Inbox" count={3} />
          <NavItem icon={Calendar} label="Calendar" />
          <NavItem icon={Users} label="Meeting" />
          <NavItem icon={FileText} label="Dock" />
        </nav>

        {/* User / Footer */}
        <div className="mt-auto pt-6 border-t border-border px-2">
          <div className="flex items-center gap-3 p-2 rounded-xl hover:bg-accent cursor-pointer transition-colors">
            <div className="w-8 h-8 rounded-full bg-linear-to-br from-purple-500 to-indigo-500 border border-foreground/10" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">Pulkit</div>
              <div className="text-xs text-muted-foreground truncate">Pro Plan</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-background">
        <div className="max-w-5xl mx-auto p-8 md:p-12">
          {/* Header */}
          <div className="flex justify-between items-end mb-10">
            <div>
                <h1 className="text-3xl font-bold text-foreground mb-2">Tasks</h1>
                <p className="text-muted-foreground">
                  Manage your canvases and collaborative spaces.
                </p>
              </div>
              <button
                onClick={handleCreateRoom}
                className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-xl font-medium hover:bg-primary/90 transition-colors shadow-lg shadow-primary/5"
              >
                <Plus className="w-5 h-5" />
                Create Canvas
              </button>
            </div>

            {/* Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Create New Card */}
              <button
                onClick={handleCreateRoom}
                className="group flex flex-col items-center justify-center gap-4 h-64 rounded-3xl border border-dashed border-border bg-card hover:bg-accent hover:border-foreground/20 transition-all cursor-pointer"
              >
                <div className="w-12 h-12 rounded-full bg-accent flex items-center justify-center group-hover:bg-primary/10 transition-colors border border-foreground/5">
                  <Plus className="w-6 h-6 text-muted-foreground group-hover:text-foreground" />
                </div>
                <span className="text-muted-foreground font-medium group-hover:text-foreground">
                  New Canvas
                </span>
              </button>

              {/* Recent Rooms */}
              {recentRooms.map((room) => (
                <div
                  key={room.roomId}
                  onClick={() => router.push(`/canvas/${room.roomId}`)}
                  className="group relative flex flex-col h-64 rounded-3xl bg-card border border-border hover:border-foreground/10 p-1 cursor-pointer overflow-hidden hover:shadow-2xl hover:shadow-black/50 transition-all"
                >
                  {/* Preview Area */}
                  <div className="flex-1 bg-accent rounded-[20px] mb-1 relative overflow-hidden group-hover:bg-primary/5 transition-colors">
                    {/* Abstract placeholder for canvas content */}
                    <div className="absolute inset-0 opacity-20 flex items-center justify-center">
                      <Layers className="w-16 h-16 text-muted-foreground" />
                    </div>

                    <div className="absolute top-4 right-4 bg-black/40 backdrop-blur-md px-2 py-1 rounded-lg text-xs text-muted-foreground flex items-center gap-1 border border-foreground/5">
                      <Clock className="w-3 h-3" />
                      {new Date(room.lastModified).toLocaleDateString()}
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="h-16 px-5 flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate max-w-[150px]">
                        {room.roomId}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Edited just now
                      </span>
                    </div>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-accent text-muted-foreground transition-colors">
                      <MoreHorizontal className="w-5 h-5" />
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </main>
    </div>
  );
}

function NavItem({
  icon: Icon,
  label,
  active = false,
  count,
}: {
  icon: any;
  label: string;
  active?: boolean;
  count?: number;
}) {
  return (
    <a
      href="#"
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group ${
        active
          ? "bg-accent text-foreground font-medium shadow-sm border border-foreground/5"
          : "text-muted-foreground hover:text-foreground hover:bg-card"
      }`}
    >
      <Icon
        className={`w-5 h-5 ${active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"}`}
      />
      <span>{label}</span>
      {count !== undefined && (
        <span
          className={`ml-auto text-xs ${active ? "text-white" : "text-gray-600"}`}
        >
          {count}
        </span>
      )}
    </a>
  );
}
