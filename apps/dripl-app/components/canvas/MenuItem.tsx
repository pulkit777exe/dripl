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
    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md transition-colors duration-150 text-sm group ${
      highlight
        ? "text-tool-active-text hover:bg-panel-menu-active"
        : "text-foreground hover:bg-panel-menu-active"
    }`}
  >
    <div className="flex items-center gap-3">
      <span className="text-muted-foreground group-hover:text-foreground">
        {icon}
      </span>
      <span className="font-normal">{label}</span>
    </div>
    {shortcut && (
      <span className="text-xs text-muted-foreground font-mono tabular-nums">
        {shortcut}
      </span>
    )}
  </button>
);
