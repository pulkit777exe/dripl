"use client";

import { useRef, useEffect } from "react";
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
  ExternalLink,
} from "lucide-react";

interface MenuProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenCommandPalette?: () => void;
  onResetCanvas?: () => void;
  onExportImage?: () => void;
  onLiveCollaboration?: () => void;
}

const CANVAS_BACKGROUNDS_LIGHT = [
  "#ffffff",
  "#f5f5f5",
  "#fffbe6",
  "#e6f0ff",
  "#f0ffe6",
];
const CANVAS_BACKGROUNDS_DARK = [
  "#1e1e1e",
  "#232329",
  "#2a2a3a",
  "#1a2535",
  "#1a2e1a",
];

type MenuItem =
  | {
      divider?: false;
      icon: React.ComponentType<{ size?: number; className?: string }>;
      label: string;
      shortcut?: string;
      onClick?: () => void;
      danger?: boolean;
    }
  | { divider: true };

export function Menu({
  isOpen,
  onClose,
  onOpenCommandPalette,
  onResetCanvas,
  onExportImage,
  onLiveCollaboration,
}: MenuProps) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

  const menuItems: MenuItem[] = [
    { icon: FolderOpen, label: "Open", shortcut: "Ctrl+O" },
    { icon: Save, label: "Save to…" },
    {
      icon: Image,
      label: "Export image…",
      shortcut: "Ctrl+Shift+E",
      onClick: onExportImage,
    },
    {
      icon: Users,
      label: "Live collaboration…",
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
      onClick: onResetCanvas,
      danger: true,
    },
  ];

  const externalLinks = [
    { icon: ExternalLink, label: "Dripl+", href: "#" },
    { icon: Github, label: "GitHub", href: "https://github.com" },
    { icon: Twitter, label: "Follow us", href: "https://twitter.com" },
    { icon: MessageCircle, label: "Discord chat", href: "#" },
    { icon: UserPlus, label: "Sign up", href: "/signup" },
  ];

  const isDark = resolvedTheme === "dark";
  const bgSwatches = isDark
    ? CANVAS_BACKGROUNDS_DARK
    : CANVAS_BACKGROUNDS_LIGHT;

  return (
    <div
      ref={menuRef}
      className={`sidebar-panel absolute top-14 left-4 z-200 rounded-xl shadow-2xl w-64 py-2 overflow-hidden pointer-events-auto${isOpen ? " is-open" : ""}`}
      style={{
        backgroundColor: "var(--color-panel-bg)",
        border: "1px solid var(--color-panel-border)",
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {menuItems.map((item, index) =>
        item.divider ? (
          <div
            key={`div-${index}`}
            className="h-px my-1.5 mx-2"
            style={{ backgroundColor: "var(--color-panel-divider)" }}
          />
        ) : (
          <button
            key={item.label}
            onClick={() => {
              item.onClick?.();
              if (!item.onClick) onClose();
            }}
            className="w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors duration-100"
            style={{
              color: item.danger
                ? "var(--color-destructive)"
                : "var(--color-foreground)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                "var(--color-panel-menu-active)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                "transparent";
            }}
          >
            <span
              style={{
                color: item.danger
                  ? "var(--color-destructive)"
                  : "var(--color-muted-foreground)",
                flexShrink: 0,
                display: "flex",
              }}
            >
              <item.icon size={15} />
            </span>
            <span className="flex-1 text-left">{item.label}</span>
            {item.shortcut && (
              <span
                className="text-xs tabular-nums"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                {item.shortcut}
              </span>
            )}
          </button>
        ),
      )}

      <div
        className="h-px my-1.5 mx-2"
        style={{ backgroundColor: "var(--color-panel-divider)" }}
      />

      {externalLinks.map((link) => (
        <a
          key={link.label}
          href={link.href}
          target={link.href.startsWith("http") ? "_blank" : undefined}
          rel="noopener noreferrer"
          className="w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors duration-100 cursor-pointer"
          style={{ color: "var(--color-foreground)" }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.backgroundColor =
              "var(--color-panel-menu-active)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.backgroundColor =
              "transparent";
          }}
        >
          <span
            style={{
              color: "var(--color-muted-foreground)",
              flexShrink: 0,
              display: "flex",
            }}
          >
            <link.icon size={15} />
          </span>
          <span>{link.label}</span>
        </a>
      ))}

      <div
        className="h-px my-1.5 mx-2"
        style={{ backgroundColor: "var(--color-panel-divider)" }}
      />

      <div className="px-4 py-2">
        <div className="flex items-center justify-between">
          <span
            className="text-sm"
            style={{ color: "var(--color-foreground)" }}
          >
            Theme
          </span>
          <div
            className="flex gap-0.5 p-0.5 rounded-lg"
            style={{ backgroundColor: "var(--color-panel-btn-bg)" }}
          >
            {(["light", "dark", "system"] as const).map((t) => {
              const isSelected = theme === t;
              const Icon = t === "light" ? Sun : t === "dark" ? Moon : Monitor;
              return (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className="p-1.5 rounded-md transition-all duration-150"
                  style={
                    isSelected
                      ? {
                          backgroundColor: "var(--color-primary)",
                          color: "var(--color-primary-foreground)",
                        }
                      : {
                          color: "var(--color-muted-foreground)",
                        }
                  }
                  title={t.charAt(0).toUpperCase() + t.slice(1)}
                  aria-label={`${t} theme`}
                >
                  <Icon size={13} />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="px-4 py-1.5">
        <div className="flex items-center justify-between">
          <span
            className="text-sm"
            style={{ color: "var(--color-foreground)" }}
          >
            Language
          </span>
          <select
            className="rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2"
            style={{
              backgroundColor: "var(--color-panel-btn-bg)",
              border: "1px solid var(--color-panel-border)",
              color: "var(--color-foreground)",
              outline: "none",
            }}
          >
            <option value="en">English</option>
          </select>
        </div>
      </div>

      <div className="px-4 py-2">
        <span
          className="text-xs block mb-2"
          style={{ color: "var(--color-panel-label)" }}
        >
          Canvas background
        </span>
        <div className="flex gap-1.5">
          {bgSwatches.map((color) => (
            <button
              key={color}
              className="w-6 h-6 rounded-md border-2 transition-all duration-150 hover:scale-110"
              style={{
                backgroundColor: color,
                borderColor: "var(--color-panel-border)",
              }}
              title={color}
              aria-label={`Canvas background ${color}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
