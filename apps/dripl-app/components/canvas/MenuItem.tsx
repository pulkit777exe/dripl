'use client';

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
        ? 'text-[#E8462A] hover:bg-[#FAE8E5]'
        : 'text-[#1A1917] hover:bg-[#FAE8E5]'
    }`}
  >
    <div className="flex items-center gap-3">
      <span className="text-[#6B6860] group-hover:text-[#1A1917]">{icon}</span>
      <span className="font-normal">{label}</span>
    </div>
    {shortcut && (
      <span className="text-xs text-[#6B6860] font-mono tabular-nums">{shortcut}</span>
    )}
  </button>
);
