import React from "react";
import { Menu, Library, Globe, Share2, MoreHorizontal } from "lucide-react";
import { useAuth } from "@/app/context/AuthContext";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api/client";
import { useCanvasStore } from "@/lib/canvas-store";

export const TopBar: React.FC = () => {
  const { user, loading } = useAuth();
  const router = useRouter();
  const elements = useCanvasStore((state) => state.elements);

  const handleDriplPlusClick = async () => {
    alert("Dripl+ button clicked!");
    console.log("Dripl+ button clicked");
    console.log("User:", user);
    console.log("Elements:", elements);

    if (!user) {
      console.log("User not logged in, redirecting to login");
      router.push("/login");
      return;
    }

    try {
      console.log("Creating new room...");
      const response = await apiClient.createRoom({
        name: "Local Canvas",
        isPublic: false,
      });
      console.log("Room creation response:", response);

      if (response.room) {
        console.log("Saving canvas elements to room...");
        await apiClient.updateRoom(response.room.slug, {
          content: JSON.stringify(elements),
        });

        console.log("Redirecting to new room:", `/canvas/${response.room.slug}`);
        router.push(`/canvas/${response.room.slug}`);
      }
    } catch (error) {
      console.error("Failed to create room:", error);
      alert("Failed to create room. Please try again.");
    }
  };

  return (
    <>
      <div className="absolute top-4 left-4 z-[100] flex gap-2 pointer-events-auto">
        <button 
          className="p-2 rounded-lg border border-border shadow-sm transition-colors bg-card hover:bg-accent text-foreground"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Menu size={20} />
        </button>

        <button 
          className="p-2 rounded-lg border border-border shadow-sm transition-colors bg-card hover:bg-accent text-foreground"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Library size={20} />
        </button>
      </div>

      <div className="absolute top-4 right-4 z-[100] flex gap-2 pointer-events-auto">
        <button
          className="px-3 py-1.5 bg-yellow-500 text-xs font-medium hover:bg-yellow-600 rounded-lg border border-yellow-700 text-black flex items-center gap-1.5"
          onClick={(e) => {
            e.stopPropagation();
            alert("Dripl+ button clicked!");
            console.log("Dripl+ button clicked");
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          disabled={loading}
        >
          <Globe size={14} />
          Dripl+
        </button>
        <button 
          className="px-4 py-1.5 bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 rounded-lg flex items-center gap-1.5 shadow-sm"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Share2 size={14} />
          Share
        </button>
        <button 
          className="p-2 bg-card hover:bg-accent rounded-lg border border-border text-muted-foreground"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <MoreHorizontal size={18} />
        </button>
      </div>
    </>
  );
};
