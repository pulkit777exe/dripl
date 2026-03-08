"use client";

import React, { useState } from "react";
import {
  Menu as MenuIcon,
  Library,
  Share2,
  MoreHorizontal,
} from "lucide-react";
import { useAuth } from "@/app/context/AuthContext";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api/client";
import { useCanvasStore } from "@/lib/canvas-store";
import { Menu } from "./Menu";
import { ShareModal } from "./ShareModal";
import { CanvasContentSchema, type DriplElement } from "@dripl/common";
import { downloadBlob, exportCanvas } from "@/utils/export";
import HelpModal from "./HelpModal";

export const TopBar: React.FC = () => {
  const { user, loading } = useAuth();
  const router = useRouter();
  const elements = useCanvasStore((state) => state.elements);
  const fileId = useCanvasStore((state) => state.fileId);
  const zoom = useCanvasStore((state) => state.zoom);
  const panX = useCanvasStore((state) => state.panX);
  const panY = useCanvasStore((state) => state.panY);
  const gridEnabled = useCanvasStore((state) => state.gridEnabled);
  const gridSize = useCanvasStore((state) => state.gridSize);
  const theme = useCanvasStore((state) => state.theme);
  const fileName = useCanvasStore((state) => state.fileName);
  const setElements = useCanvasStore((state) => state.setElements);
  const setPan = useCanvasStore((state) => state.setPan);
  const setZoom = useCanvasStore((state) => state.setZoom);
  const setGridEnabled = useCanvasStore((state) => state.setGridEnabled);
  const setGridSize = useCanvasStore((state) => state.setGridSize);
  const setSelectedIds = useCanvasStore((state) => state.setSelectedIds);
  const setTheme = useCanvasStore((state) => state.setTheme);
  const setFileMetadata = useCanvasStore((state) => state.setFileMetadata);

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [activeLanguage, setActiveLanguage] = useState("en");

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem("dripl-language") || "en";
    setActiveLanguage(stored);
    document.documentElement.lang = stored;
  }, []);

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

  const handleExportToLink = async (
    permission: "view" | "edit",
    expiresIn?: number,
  ): Promise<string | null> => {
    try {
      const payload: {
        fileId?: string;
        elements: typeof elements;
        name: string;
        permission: "view" | "edit";
        expiresIn?: number;
      } = {
        elements,
        name: "Shared Canvas",
        permission,
      };

      if (fileId) {
        payload.fileId = fileId;
      }
      if (typeof expiresIn === "number") {
        payload.expiresIn = expiresIn;
      }

      const response = await fetch("/api/share", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        let details = "";
        try {
          const body = (await response.json()) as {
            error?: string;
            details?: unknown;
          };
          details = body.error ?? "";
        } catch {
          // ignore body parse failures
        }
        throw new Error(details || `Failed to share canvas (${response.status})`);
      }

      const data = await response.json();
      const link = data.url ?? `${window.location.origin}/board/${data.token}`;
      await navigator.clipboard.writeText(link);
      return link;
    } catch (error) {
      console.error("Error sharing canvas:", error);
      alert("Failed to create share link. Please try again.");
      return null;
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

  const handleSaveToFile = () => {
    const payload = {
      version: 1,
      type: "dripl-scene",
      exportedAt: Date.now(),
      elements,
      appState: {
        zoom,
        panX,
        panY,
        gridEnabled,
        gridSize,
        theme,
        fileName,
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const safeName = (fileName || "untitled")
      .replace(/[^a-z0-9-_]+/gi, "-")
      .toLowerCase();
    downloadBlob(blob, `${safeName || "untitled"}.dripl`);
    setIsMenuOpen(false);
  };

  const handleOpenFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".dripl,application/json";
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const raw = await file.text();
        const parsed = JSON.parse(raw) as unknown;

        let importedElements: DriplElement[] = [];
        let importedAppState:
          | {
              zoom?: number;
              panX?: number;
              panY?: number;
              gridEnabled?: boolean;
              gridSize?: number;
              theme?: "light" | "dark" | "system";
            }
          | undefined;

        if (Array.isArray(parsed)) {
          importedElements = CanvasContentSchema.parse(parsed) as DriplElement[];
        } else if (parsed && typeof parsed === "object" && "elements" in parsed) {
          const scene = parsed as {
            elements?: unknown;
            appState?: {
              zoom?: number;
              panX?: number;
              panY?: number;
              gridEnabled?: boolean;
              gridSize?: number;
              theme?: "light" | "dark" | "system";
            };
          };
          importedElements = CanvasContentSchema.parse(scene.elements ?? []) as DriplElement[];
          importedAppState = scene.appState;
        } else {
          throw new Error("Invalid .dripl file format");
        }

        setElements(importedElements);
        setSelectedIds(new Set<string>());
        if (importedAppState) {
          if (typeof importedAppState.zoom === "number") setZoom(importedAppState.zoom);
          if (
            typeof importedAppState.panX === "number" &&
            typeof importedAppState.panY === "number"
          ) {
            setPan(importedAppState.panX, importedAppState.panY);
          }
          if (typeof importedAppState.gridEnabled === "boolean") {
            setGridEnabled(importedAppState.gridEnabled);
          }
          if (typeof importedAppState.gridSize === "number") {
            setGridSize(importedAppState.gridSize);
          }
          if (importedAppState.theme) {
            setTheme(importedAppState.theme);
          }
        }
        setFileMetadata(null, file.name.replace(/\.dripl$/i, ""));
      } catch (error) {
        console.error("Failed to open .dripl file:", error);
        alert("Could not open this file. Please choose a valid .dripl file.");
      }
    };
    input.click();
    setIsMenuOpen(false);
  };

  const handleExportImage = async () => {
    try {
      const blob = await Promise.resolve(
        exportCanvas("png", elements, {
          scale: 2,
          background: "#ffffff",
          padding: 16,
        }),
      );
      downloadBlob(blob, `canvas-${Date.now()}.png`);
    } catch (error) {
      console.error("PNG export failed:", error);
      alert("Failed to export PNG image.");
    } finally {
      setIsMenuOpen(false);
    }
  };

  const handleFindOnCanvas = () => {
    const query = window.prompt("Find on canvas", "");
    if (!query || !query.trim()) return;
    window.dispatchEvent(
      new CustomEvent("dripl:find-on-canvas", {
        detail: { query: query.trim() },
      }),
    );
    setIsMenuOpen(false);
  };

  const handleOpenCommandPalette = () => {
    window.dispatchEvent(new CustomEvent("dripl:open-command-palette"));
    setIsMenuOpen(false);
  };

  const handleOpenHelp = () => {
    setIsHelpOpen(true);
    setIsMenuOpen(false);
  };

  const handleLanguageChange = (languageCode: string) => {
    setActiveLanguage(languageCode);
    localStorage.setItem("dripl-language", languageCode);
    document.documentElement.lang = languageCode;
  };

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      const cmdOrCtrl = event.metaKey || event.ctrlKey;
      if (!cmdOrCtrl) return;
      const key = event.key.toLowerCase();

      if (key === "o") {
        event.preventDefault();
        handleOpenFile();
        return;
      }

      if (key === "s") {
        event.preventDefault();
        handleSaveToFile();
        return;
      }

      if (key === "e" && event.shiftKey) {
        event.preventDefault();
        void handleExportImage();
        return;
      }

      if (key === "/") {
        event.preventDefault();
        handleOpenCommandPalette();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    handleExportImage,
    handleOpenCommandPalette,
    handleOpenFile,
    handleSaveToFile,
  ]);

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
        onOpenFile={handleOpenFile}
        onSaveToFile={handleSaveToFile}
        onExportImage={handleExportImage}
        onFindOnCanvas={handleFindOnCanvas}
        onOpenHelp={handleOpenHelp}
        onOpenCommandPalette={handleOpenCommandPalette}
        activeLanguage={activeLanguage}
        onLanguageChange={handleLanguageChange}
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
      {isHelpOpen && <HelpModal onClose={() => setIsHelpOpen(false)} />}
    </>
  );
};
