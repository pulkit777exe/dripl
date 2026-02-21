"use client";

import { useState, useRef, useEffect } from "react";
import { useTheme } from "next-themes";
import {
  FolderOpen,
  Save,
  Image,
  Users,
  Command,
  Search,
  HelpCircle,
  Trash2,
  Sun,
  Moon,
  Monitor,
  Github,
  Twitter,
  MessageCircle,
  UserPlus,
} from "lucide-react";

interface MenuProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenCommandPalette?: () => void;
  onResetCanvas?: () => void;
  onExportImage?: () => void;
  onLiveCollaboration?: () => void;
}

const CANVAS_BACKGROUNDS = [
  "#1e1e2e",
  "#232329",
  "#2a2a3a",
  "#3a3a4a",
  "#f5f5f5",
  "#ffffff",
];

export function Menu({
  isOpen,
  onClose,
  onOpenCommandPalette,
  onResetCanvas,
  onExportImage,
  onLiveCollaboration,
}: MenuProps) {
  const { theme, setTheme } = useTheme();
  const [canvasBackground, setCanvasBackground] = useState("#1e1e2e");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const menuItems = [
    { icon: FolderOpen, label: "Open", shortcut: "Ctrl+O" },
    { icon: Save, label: "Save to...", shortcut: "" },
    {
      icon: Image,
      label: "Export image...",
      shortcut: "Ctrl+Shift+E",
      onClick: onExportImage,
    },
    {
      icon: Users,
      label: "Live collaboration...",
      shortcut: "",
      onClick: onLiveCollaboration,
    },
    { divider: true },
    {
      icon: Command,
      label: "Command palette",
      shortcut: "Ctrl+/",
      onClick: onOpenCommandPalette,
    },
    { icon: Search, label: "Find on canvas", shortcut: "Ctrl+F" },
    { divider: true },
    { icon: HelpCircle, label: "Help", shortcut: "?" },
    {
      icon: Trash2,
      label: "Reset the canvas",
      shortcut: "",
      onClick: onResetCanvas,
    },
  ];

  const externalLinks = [
    { icon: Github, label: "Dripl+", href: "#" },
    { icon: Github, label: "GitHub", href: "https://github.com" },
    { icon: Twitter, label: "Follow us", href: "https://twitter.com" },
    { icon: MessageCircle, label: "Discord chat", href: "#" },
    { icon: UserPlus, label: "Sign up", href: "/signup" },
  ];

  return (
    <div
      ref={menuRef}
      className="absolute top-14 left-4 z-200 bg-panel-bg border border-panel-border rounded-xl shadow-xl w-64 py-2 pointer-events-auto animate-in fade-in slide-in-from-top-2 duration-200"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {menuItems.map((item, index) =>
        item.divider ? (
          <div key={index} className="h-px bg-panel-divider my-2" />
        ) : (
          <button
            key={index}
            onClick={() => {
              item.onClick?.();
              if (!item.onClick) onClose();
            }}
            className="w-full flex items-center gap-3 px-4 py-2 text-sm text-foreground hover:bg-panel-menu-active transition-colors duration-150"
          >
            {item.icon && (
              <item.icon size={16} className="text-muted-foreground" />
            )}
            <span className="flex-1 text-left">{item.label}</span>
            {item.shortcut && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {item.shortcut}
              </span>
            )}
          </button>
        ),
      )}

      <div className="h-px bg-panel-divider my-2" />

      {externalLinks.map((link, index) => (
        <a
          key={index}
          href={link.href}
          target={link.href.startsWith("http") ? "_blank" : undefined}
          rel="noopener noreferrer"
          className="w-full flex items-center gap-3 px-4 py-2 text-sm text-foreground hover:bg-panel-menu-active transition-colors duration-150"
        >
          <link.icon size={16} className="text-muted-foreground" />
          <span>{link.label}</span>
        </a>
      ))}

      <div className="h-px bg-panel-divider my-2" />

      <div className="px-4 py-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-foreground">Theme</span>
          <div className="flex gap-1 bg-panel-btn-bg rounded-lg p-0.5">
            <button
              onClick={() => setTheme("light")}
              className={`p-1.5 rounded-md transition-colors duration-150 ${
                theme === "light"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="Light"
              aria-label="Light theme"
            >
              <Sun size={14} />
            </button>
            <button
              onClick={() => setTheme("dark")}
              className={`p-1.5 rounded-md transition-colors duration-150 ${
                theme === "dark"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="Dark"
              aria-label="Dark theme"
            >
              <Moon size={14} />
            </button>
            <button
              onClick={() => setTheme("system")}
              className={`p-1.5 rounded-md transition-colors duration-150 ${
                theme === "system"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="System"
              aria-label="System theme"
            >
              <Monitor size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="px-4 py-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-foreground">Language</span>
          <select className="bg-panel-btn-bg border border-panel-border rounded-lg px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary">
            <option value="en">English</option>
          </select>
        </div>
      </div>

      <div className="px-4 py-2">
        <span className="text-sm text-panel-label block mb-2">
          Canvas background
        </span>
        <div className="flex gap-2">
          {CANVAS_BACKGROUNDS.map((color) => (
            <button
              key={color}
              onClick={() => setCanvasBackground(color)}
              className={`w-6 h-6 rounded border-2 transition-all duration-150 ${
                canvasBackground === color
                  ? "border-primary scale-110"
                  : "border-transparent hover:border-panel-label"
              }`}
              style={{ backgroundColor: color }}
              title={color}
              aria-label={`Canvas background ${color}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
