"use client";

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onClick?: () => void;
  highlight?: boolean;
}

export const MenuItem: React.FC<MenuItemProps> = ({
  icon,
  label,
  shortcut,
  onClick,
  highlight,
}) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md transition-colors text-sm group ${
      highlight
        ? "text-[var(--color-tool-active-text)] hover:bg-[var(--color-tool-active-bg)]/30"
        : "text-[var(--color-tool-inactive-text)] hover:bg-[var(--color-tool-hover-bg)]"
    }`}
  >
    <div className="flex items-center gap-3">
      <span
        className={
          highlight
            ? "text-[var(--color-tool-active-text)]"
            : "text-[var(--color-tool-inactive-text)] group-hover:text-[var(--color-tool-hover-text)]"
        }
      >
        {icon}
      </span>
      <span className="font-normal">{label}</span>
    </div>
    {shortcut && (
      <span className="text-xs text-[var(--color-tool-inactive-text)] font-mono bg-[var(--color-panel-btn-bg)] px-1.5 py-0.5 rounded">
        {shortcut}
      </span>
    )}
  </button>
);
