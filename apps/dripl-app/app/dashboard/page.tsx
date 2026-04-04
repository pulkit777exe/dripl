"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import { apiClient } from "../../lib/api/client";
import { FileBrowser } from "../../components/dashboard/FileBrowser";

type CanvasRoom = {
  id: string;
  slug: string;
  name: string;
  updatedAt: string;
  createdAt: string;
  isPublic: boolean;
};

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [rooms, setRooms] = useState<CanvasRoom[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    } else if (!authLoading && user) {
      loadRooms();
    }
  }, [user, authLoading, router]);

  const loadRooms = async () => {
    try {
      const response = await apiClient.getRooms();
      setRooms(response.rooms ?? []);
    } catch (error) {
      console.error("Failed to load rooms:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFile = async () => {
    try {
      const response = await apiClient.createRoom({
        name: "Untitled Canvas",
        isPublic: false,
      });
      if (response.room) {
        router.push(`/canvas/${response.room.slug}`);
      }
    } catch (error) {
      console.error("Failed to create room:", error);
    }
  };

  const handleStartNewCanvas = () => {
    const newRoomSlug = crypto.randomUUID();
    localStorage.setItem("dripl_last_canvas", newRoomSlug);
    router.push(`/canvas/${newRoomSlug}`);
  };

  const handleDeleteFile = async (id: string) => {
    try {
      await apiClient.deleteRoom(id);
      setRooms((prev) => prev.filter((room) => room.slug !== id));
    } catch (error) {
      console.error("Failed to delete room:", error);
    }
  };

  const handleRenameFile = async (id: string, name: string) => {
    try {
      await apiClient.updateRoom(id, { name });
      setRooms((prev) =>
        prev.map((room) => (room.slug === id ? { ...room, name } : room)),
      );
    } catch (error) {
      console.error("Failed to rename room:", error);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center h-dvh bg-[#F5F0E8] dark:bg-[#141210]">
        <div className="text-[#7A7267] dark:text-[#8A7F72] font-[var(--font-source-sans)]">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="flex h-dvh w-full bg-[#F5F0E8] dark:bg-[#141210] text-[#1A1A1A] dark:text-[#E8E0D4]">
      <FileBrowser
        files={rooms.map((room) => ({
          id: room.slug,
          name: room.name,
          updatedAt: room.updatedAt,
          createdAt: room.createdAt,
        }))}
        onCreateFile={handleCreateFile}
        onStartNewCanvas={handleStartNewCanvas}
        onDeleteFile={handleDeleteFile}
        onRenameFile={handleRenameFile}
      />
    </div>
  );
  }
