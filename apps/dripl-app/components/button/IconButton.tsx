import { IconButtonProps } from "@/eraser";
import { cn } from "@/lib/utils";

export const IconButton: React.FC<IconButtonProps> = ({
  icon,
  isActive,
  onClick,
  className = "",
}) => {
  const handleClick = () => {
    console.log("IconButton clicked", icon);
    if (onClick) onClick();
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        "p-2 rounded-lg transition-colors flex items-center justify-center",
        isActive 
          ? "bg-(--color-tool-active-bg) text-(--color-tool-active-text)" 
          : "hover:bg-(--color-tool-hover-bg) text-(--color-tool-inactive-text) hover:text-(--color-tool-hover-text)",
        className
      )}
    >
      {icon}
    </button>
  );
};
