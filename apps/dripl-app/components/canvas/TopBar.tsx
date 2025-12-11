import React from "react";
import { Menu, Library, Globe, Share2, MoreHorizontal } from "lucide-react";

export const TopBar: React.FC = () => {
  return (
    <>
      <div className="absolute top-4 left-4 z-50 flex gap-2">
        <button className="p-2 rounded-lg border border-gray-700 shadow-sm transition-colors bg-[#232329] hover:bg-[#31303b] text-gray-300">
          <Menu size={20} />
        </button>

        <button className="p-2 rounded-lg border border-gray-700 shadow-sm transition-colors bg-[#232329] hover:bg-[#31303b] text-gray-300">
          <Library size={20} />
        </button>
      </div>

      <div className="absolute top-4 right-4 z-50 flex gap-2">
        <button className="px-3 py-1.5 bg-[#232329] text-xs font-medium hover:bg-[#31303b] rounded-lg border border-gray-700 text-gray-300 flex items-center gap-1.5">
          <Globe size={14} />
          Dripl+
        </button>
        <button className="px-4 py-1.5 bg-[#a8a5ff] text-gray-900 text-xs font-bold hover:bg-[#8f8fff] rounded-lg flex items-center gap-1.5 shadow-sm">
          <Share2 size={14} />
          Share
        </button>
        <button className="p-2 bg-[#232329] hover:bg-[#31303b] rounded-lg border border-gray-700 text-gray-400">
          <MoreHorizontal size={18} />
        </button>
      </div>
    </>
  );
};
