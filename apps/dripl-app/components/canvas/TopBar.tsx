import React from "react";
import { Menu, Library, Globe, Share2, MoreHorizontal } from "lucide-react";

export const TopBar: React.FC = () => {
  return (
    <>
      <div className="absolute top-4 left-4 z-50 flex gap-2">
        <button className="p-2 rounded-lg border border-border shadow-sm transition-colors bg-card hover:bg-accent text-foreground">
          <Menu size={20} />
        </button>

        <button className="p-2 rounded-lg border border-border shadow-sm transition-colors bg-card hover:bg-accent text-foreground">
          <Library size={20} />
        </button>
      </div>

      <div className="absolute top-4 right-4 z-50 flex gap-2">
        <button className="px-3 py-1.5 bg-card text-xs font-medium hover:bg-accent rounded-lg border border-border text-foreground flex items-center gap-1.5">
          <Globe size={14} />
          Dripl+
        </button>
        <button className="px-4 py-1.5 bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 rounded-lg flex items-center gap-1.5 shadow-sm">
          <Share2 size={14} />
          Share
        </button>
        <button className="p-2 bg-card hover:bg-accent rounded-lg border border-border text-muted-foreground">
          <MoreHorizontal size={18} />
        </button>
      </div>
    </>
  );
};
