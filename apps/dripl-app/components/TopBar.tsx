"use client";

import React from "react";
import { Menu, User, ChevronDown } from "lucide-react";

export function TopBar() {
  return (
    <header className="fixed left-14 right-0 top-0 z-50 flex h-14 items-center justify-between border-b bg-background px-4">
      <div className="flex items-center gap-4">
        <button className="flex items-center justify-center rounded-md p-2 hover:bg-accent hover:text-accent-foreground">
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <span className="font-semibold">Untitled File</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground">
          <div className="h-2 w-2 rounded-full bg-green-500" />
          Saved
        </div>
        <button className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <User className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
