import React from "react";

interface IconButtonProps {
  icon: React.ReactNode;
  isActive?: boolean;
  onClick?: () => void;
  title?: string;
}

export const ToolButton: React.FC<IconButtonProps> = ({
  icon,
  isActive,
  onClick,
  title,
}) => {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-2 rounded-lg transition-all duration-200 ${
        isActive
          ? "bg-[#403c66] text-[#a8a5ff] shadow-sm shadow-[#a8a5ff]/20"
          : "text-gray-400 hover:bg-[#31303b] hover:text-gray-200"
      }`}
    >
      {icon}
    </button>
  );
};
