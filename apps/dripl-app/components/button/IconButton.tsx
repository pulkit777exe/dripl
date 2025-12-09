import { IconButtonProps } from "@/eraser";

export const IconButton: React.FC<IconButtonProps> = ({ icon, isActive, onClick, className = "" }) => {
  return (
    <button
      onClick={onClick}
      className={`
        p-2 rounded-lg transition-colors flex items-center justify-center
        ${isActive 
          ? 'bg-[#403c66] text-[#a8a5ff]' 
          : 'hover:bg-[#31303b] text-gray-400'}
        ${className}
      `}
    >
      {icon}
    </button>
  );
};