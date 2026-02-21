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
          className="p-2 rounded-md border border-toolbar-border bg-toolbar-bg hover:bg-tool-hover-bg text-foreground transition-colors duration-150"
          onClick={(e) => {
            e.stopPropagation();
            setIsMenuOpen(!isMenuOpen);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label="Open menu"
        >
          <MenuIcon size={20} />
        </button>

        <button
          className="p-2 rounded-md border border-toolbar-border bg-toolbar-bg hover:bg-tool-hover-bg text-foreground transition-colors duration-150"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label="Library"
        >
          <Library size={20} />
        </button>
      </div>

      <div className="absolute top-4 right-4 z-100 flex items-center gap-2 pointer-events-auto">
        <span className="text-sm font-medium text-foreground px-2">
          Excalidraw+
        </span>
        <button
          className="px-4 py-1.5 bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 rounded-lg flex items-center gap-1.5 transition-opacity duration-150"
          onClick={(e) => {
            e.stopPropagation();
            setIsShareModalOpen(true);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label="Share"
        >
          <Share2 size={14} />
          Share
        </button>
        <button
          className="p-2 rounded-md bg-toolbar-bg hover:bg-tool-hover-bg border border-toolbar-border text-foreground transition-colors duration-150"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label="Document options"
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
