"use client";

import React, { useState } from "react";
import {
  Menu as MenuIcon,
  Library,
  Globe,
  Share2,
  MoreHorizontal,
} from "lucide-react";
import { useAuth } from "@/app/context/AuthContext";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api/client";
import { useCanvasStore } from "@/lib/canvas-store";
import { Menu } from "./Menu";
import { ShareModal } from "./ShareModal";

export const TopBar: React.FC = () => {
  const { user, loading } = useAuth();
  const router = useRouter();
  const elements = useCanvasStore((state) => state.elements);

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  const handleDriplPlusClick = async () => {
    if (!user) {
      router.push("/login");
      return;
    }

    try {
      const response = await apiClient.createRoom({
        name: "Local Canvas",
        isPublic: false,
      });

      if (response.room) {
        await apiClient.updateRoom(response.room.slug, {
          content: JSON.stringify(elements),
        });
        router.push(`/canvas/${response.room.slug}`);
      }
    } catch (error) {
      console.error("Failed to create room:", error);
      alert("Failed to create room. Please try again.");
    }
  };

  const handleStartSession = async () => {
    if (!user) {
      router.push("/login");
      return;
    }

    try {
      const response = await apiClient.createRoom({
        name: "Collaboration Session",
        isPublic: true,
      });

      if (response.room) {
        await apiClient.updateRoom(response.room.slug, {
          content: JSON.stringify(elements),
        });
        router.push(`/canvas/${response.room.slug}`);
      }
    } catch (error) {
      console.error("Failed to start session:", error);
      alert("Failed to start session. Please try again.");
    }
  };

  const handleExportToLink = async () => {
    try {
      const response = await fetch("/api/share", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          elements,
          name: "Shared Canvas",
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to share canvas");
      }

      const data = await response.json();
      const link = `${window.location.origin}/share/${data.id}`;

      await navigator.clipboard.writeText(link);
      alert("Link copied to clipboard!");
    } catch (error) {
      console.error("Error sharing canvas:", error);
      alert("Failed to create share link. Please try again.");
    } finally {
      setIsShareModalOpen(false);
    }
  };

  const handleResetCanvas = () => {
    if (
      confirm(
        "Are you sure you want to reset the canvas? This cannot be undone.",
      )
    ) {
      useCanvasStore.getState().setElements([]);
    }
    setIsMenuOpen(false);
  };

  return (
    <>
      <div className="absolute top-4 left-4 z-100 flex gap-2 pointer-events-auto">
        <button
          className="p-2 rounded-lg border border-border shadow-sm transition-colors bg-card hover:bg-accent text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            setIsMenuOpen(!isMenuOpen);
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <MenuIcon size={20} />
        </button>

        <button
          className="p-2 rounded-lg border border-border shadow-sm transition-colors bg-card hover:bg-accent text-foreground"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Library size={20} />
        </button>
      </div>

      <div className="absolute top-4 right-4 z-100 flex gap-2 pointer-events-auto">
        <button
          className="px-3 py-1.5 bg-yellow-500 text-xs font-medium hover:bg-yellow-600 rounded-lg border border-yellow-700 text-black flex items-center gap-1.5 transition-transform hover:scale-105"
          onClick={(e) => {
            e.stopPropagation();
            handleDriplPlusClick();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          disabled={loading}
        >
          <Globe size={14} />
          Dripl+
        </button>
        <button
          className="px-4 py-1.5 bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 rounded-lg flex items-center gap-1.5 shadow-sm transition-transform hover:scale-105"
          onClick={(e) => {
            e.stopPropagation();
            setIsShareModalOpen(true);
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Share2 size={14} />
          Share
        </button>
        <button
          className="p-2 bg-card hover:bg-accent rounded-lg border border-border text-muted-foreground transition-colors"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <MoreHorizontal size={18} />
        </button>
      </div>

      <Menu
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        onResetCanvas={handleResetCanvas}
        onLiveCollaboration={() => {
          setIsMenuOpen(false);
          setIsShareModalOpen(true);
        }}
      />

      <ShareModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        onStartSession={handleStartSession}
        onExportToLink={handleExportToLink}
      />
    </>
  );
};
