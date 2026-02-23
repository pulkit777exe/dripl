"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import type { DriplElement } from "@dripl/common";

import RoughCanvas from "@/components/canvas/RoughCanvas";
import { useCanvasStore } from "@/lib/canvas-store";
import {
  initRuntimeStore,
  setRuntimeStoreSync,
  snapshotFromState,
  updateRuntimeStoreSnapshot,
} from "@/lib/runtime-store-bridge";
import {
  type LocalCanvasState,
  loadLocalCanvasFromStorage,
} from "@/utils/localCanvasStorage";
import { loadInitialScene } from "@/lib/scene-loader";

type BaseProps = {
  theme: "light" | "dark";
};

type LocalModeProps = BaseProps & {
  mode: "local";
};

type RoomModeProps = BaseProps & {
  mode: "room";
  roomSlug: string;
};

type FileModeProps = BaseProps & {
  mode: "file";
  initialData: unknown;
};

export type CanvasBootstrapProps =
  | LocalModeProps
  | RoomModeProps
  | FileModeProps;

function applyAppStateToStore(appState: Partial<LocalCanvasState> | null) {
  if (!appState) {
    return;
  }

  const store = useCanvasStore.getState();

  if (appState.theme) {
    store.setTheme(appState.theme as any);
  }
  if (typeof appState.zoom === "number") {
    store.setZoom(appState.zoom);
  }
  if (typeof appState.panX === "number" && typeof appState.panY === "number") {
    store.setPan(appState.panX, appState.panY);
  }

  if (appState.currentStrokeColor) {
    store.setCurrentStrokeColor(appState.currentStrokeColor);
  }
  if (appState.currentBackgroundColor) {
    store.setCurrentBackgroundColor(appState.currentBackgroundColor);
  }
  if (typeof appState.currentStrokeWidth === "number") {
    store.setCurrentStrokeWidth(appState.currentStrokeWidth);
  }
  if (typeof appState.currentRoughness === "number") {
    store.setCurrentRoughness(appState.currentRoughness);
  }
  if (appState.currentStrokeStyle) {
    store.setCurrentStrokeStyle(appState.currentStrokeStyle as any);
  }
  if (appState.currentFillStyle) {
    store.setCurrentFillStyle(appState.currentFillStyle as any);
  }
  if (appState.activeTool) {
    store.setActiveTool(appState.activeTool as any);
  }
}

export function CanvasBootstrap(props: CanvasBootstrapProps) {
  const { theme } = props;
  const { resolvedTheme } = useTheme();

  // Keep the default stroke colour in sync with the active theme so new
  // elements are visible on the canvas without the user having to pick a
  // colour manually (dark → white, light → near-black, matching Excalidraw).
  useEffect(() => {
    const isDark = resolvedTheme === "dark";
    const store = useCanvasStore.getState();
    // Only update if the user hasn't chosen a custom colour yet (still one of
    // the automatic defaults).
    const current = store.currentStrokeColor;
    if (
      current === "#000000" ||
      current === "#1e1e1e" ||
      current === "#ffffff"
    ) {
      store.setCurrentStrokeColor(isDark ? "#ffffff" : "#1e1e1e");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme]);

  const setElements = useCanvasStore((state) => state.setElements);
  const setSelectedIds = useCanvasStore((state) => state.setSelectedIds);
  const existingElements = useCanvasStore((state) => state.elements);

  const [isInitialized, setIsInitialized] = useState(false);

  // Capture the initial elements only once so we can decide later whether
  // to prompt before overwriting them with an external scene.
  const initialElementsRef = useRef<DriplElement[] | null>(null);
  if (initialElementsRef.current === null) {
    initialElementsRef.current = existingElements;
  }

  const mode = props.mode;

  // Phase 1: init runtime Store and sync Store → Zustand when canvas is ready
  useEffect(() => {
    if (!isInitialized) return;
    const snapshot = snapshotFromState(
      useCanvasStore.getState().elements,
      useCanvasStore.getState().selectedIds,
      null,
    );
    initRuntimeStore(snapshot);
    setRuntimeStoreSync((next) => {
      useCanvasStore.getState().setElements([...next.elements]);
      useCanvasStore.getState().setSelectedIds(new Set(next.selectedIds));
    });
  }, [isInitialized]);

  const roomSlug = useMemo(
    () => (mode === "room" ? props.roomSlug : null),
    [mode, props],
  );

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      if (mode === "local") {
        const {
          elements,
          appState,
          selectedIds: loadedSelectedIds,
        } = loadLocalCanvasFromStorage();

        const initialElements = elements as DriplElement[] | null;

        if (initialElements && initialElements.length > 0) {
          setElements(initialElements);
          if (loadedSelectedIds?.length) {
            setSelectedIds(new Set(loadedSelectedIds));
          }
        } else {
          const testElements: DriplElement[] = [
            {
              id: "rect-1",
              type: "rectangle" as const,
              x: 100,
              y: 100,
              width: 200,
              height: 150,
              strokeColor: "#000000",
              backgroundColor: "#ffffff",
              strokeWidth: 2,
              opacity: 1,
              roughness: 1,
              strokeStyle: "solid",
              fillStyle: "hachure",
              seed: Math.floor(Math.random() * 1000000),
            },
            {
              id: "circle-1",
              type: "ellipse" as const,
              x: 400,
              y: 150,
              width: 150,
              height: 150,
              strokeColor: "#ff0000",
              backgroundColor: "transparent",
              strokeWidth: 3,
              opacity: 1,
              roughness: 1,
              strokeStyle: "dashed",
              fillStyle: "solid",
              seed: Math.floor(Math.random() * 1000000),
            },
            {
              id: "text-1",
              type: "text" as const,
              x: 150,
              y: 300,
              width: 300,
              height: 50,
              strokeColor: "#0000ff",
              backgroundColor: "transparent",
              strokeWidth: 1,
              opacity: 1,
              text: "Local Canvas Test",
              fontSize: 24,
              fontFamily: "Arial",
              seed: Math.floor(Math.random() * 1000000),
            },
          ];

          setElements(testElements);
        }

        applyAppStateToStore(appState as Partial<LocalCanvasState> | null);

        if (!cancelled) {
          setIsInitialized(true);
        }
        return;
      }

      if (mode === "room") {
        if (!roomSlug) {
          return;
        }

        const scene = await loadInitialScene({
          source: "room",
          roomId: roomSlug,
        });

        if (cancelled || !scene || !scene.elements.length) {
          setIsInitialized(true);
          return;
        }

        const initialElements = initialElementsRef.current || [];

        if (initialElements.length > 0 && scene.elements.length > 0) {
          const shouldOverride = window.confirm(
            "Replace the current canvas with the last saved version for this room?",
          );

          if (!shouldOverride) {
            setIsInitialized(true);
            return;
          }
        }

        setElements(scene.elements);
        updateRuntimeStoreSnapshot(snapshotFromState(scene.elements, []));

        if (!cancelled) {
          setIsInitialized(true);
        }
        return;
      }

      if (mode === "file") {
        const scene = await loadInitialScene({
          source: "file",
          initialData: props.initialData,
        });

        if (cancelled || !scene) {
          setIsInitialized(true);
          return;
        }

        const initialElements = initialElementsRef.current || [];

        if (initialElements.length > 0 && scene.elements.length > 0) {
          // We need to show the modal to the user. Since this is an async context,
          // we'll use a promise to wait for the user's decision.
          const shouldOverride = await new Promise<boolean>((resolve) => {
            const modal = document.createElement("div");
            modal.className =
              "fixed inset-0 bg-black/60 z-100 flex items-center justify-center p-4";
            modal.innerHTML = `
              <div class="w-full max-w-2xl bg-[#232329] rounded-xl border border-[#3f3f46] shadow-2xl max-h-[90vh] overflow-hidden flex flex-col">
                <div class="flex justify-between items-center p-6 border-b border-[#3f3f46]">
                  <h2 class="text-xl font-semibold text-white flex items-center gap-3">Load from link</h2>
                  <button class="p-2 text-gray-400 hover:bg-gray-700 rounded-full transition-colors close-btn">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>
                
                <div class="p-6 bg-[#ff6b6b]/10 border-b border-[#ff6b6b]/20">
                  <div class="flex items-start gap-4">
                    <div class="shrink-0 w-12 h-12 rounded-full bg-[#ff6b6b]/20 flex items-center justify-center">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff6b6b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                      </svg>
                    </div>
                    <div class="flex-1">
                      <h3 class="text-lg font-semibold text-white mb-2">Loading external drawing will replace your existing content.</h3>
                      <p class="text-gray-400">You can back up your drawing first using one of the options below.</p>
                    </div>
                  </div>
                </div>

                <div class="p-6 space-y-8">
                  <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div class="text-center">
                      <h4 class="text-lg font-medium text-white mb-2">Export as image</h4>
                      <p class="text-sm text-gray-400 mb-4">Export the scene data as an image from which you can import later.</p>
                      <button class="w-full px-4 py-2 bg-[#2a2a3a] hover:bg-[#3a3a4a] text-white rounded-lg border border-[#3f3f46] transition-colors export-image-btn">
                        Export as image
                      </button>
                    </div>

                    <div class="text-center">
                      <h4 class="text-lg font-medium text-white mb-2">Save to disk</h4>
                      <p class="text-sm text-gray-400 mb-4">Export the scene data to a file from which you can import later.</p>
                      <button class="w-full px-4 py-2 bg-[#2a2a3a] hover:bg-[#3a3a4a] text-white rounded-lg border border-[#3f3f46] transition-colors save-disk-btn">
                        Save to disk
                      </button>
                    </div>

                    <div class="text-center">
                      <h4 class="text-lg font-medium text-white mb-2">Dripl+</h4>
                      <p class="text-sm text-gray-400 mb-4">Save the scene to your Dripl+ workspace.</p>
                      <button class="w-full px-4 py-2 bg-[#2a2a3a] hover:bg-[#3a3a4a] text-white rounded-lg border border-[#3f3f46] transition-colors export-cloud-btn">
                        Export to Dripl+
                      </button>
                    </div>
                  </div>

                  <div class="pt-6 border-t border-[#3f3f46]">
                    <div class="flex justify-end gap-3">
                      <button class="px-4 py-2 text-gray-400 hover:text-white transition-colors cancel-btn">
                        Cancel
                      </button>
                      <button class="px-6 py-2 bg-[#8b5cf6] hover:bg-[#7c3aed] text-white rounded-lg font-medium transition-colors replace-btn">
                        Replace my content
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            `;
            document.body.appendChild(modal);

            // Add event listeners
            modal.querySelector(".close-btn")?.addEventListener("click", () => {
              resolve(false);
              document.body.removeChild(modal);
            });

            modal
              .querySelector(".cancel-btn")
              ?.addEventListener("click", () => {
                resolve(false);
                document.body.removeChild(modal);
              });

            modal
              .querySelector(".replace-btn")
              ?.addEventListener("click", () => {
                resolve(true);
                document.body.removeChild(modal);
              });

            modal
              .querySelector(".export-image-btn")
              ?.addEventListener("click", () => {
                // In a real app, this would trigger an export
                alert("Export as image functionality coming soon!");
              });

            modal
              .querySelector(".save-disk-btn")
              ?.addEventListener("click", () => {
                // In a real app, this would trigger a save to disk
                alert("Save to disk functionality coming soon!");
              });

            modal
              .querySelector(".export-cloud-btn")
              ?.addEventListener("click", () => {
                // In a real app, this would trigger a cloud export
                alert("Export to Dripl+ functionality coming soon!");
              });

            // Close on outside click
            modal.addEventListener("click", (e) => {
              if (e.target === modal) {
                resolve(false);
                document.body.removeChild(modal);
              }
            });
          });

          if (!shouldOverride) {
            setIsInitialized(true);
            return;
          }
        }

        if (scene.elements.length > 0) {
          setElements(scene.elements);
          updateRuntimeStoreSnapshot(snapshotFromState(scene.elements, []));
        }
        applyAppStateToStore(
          (scene.appState || null) as Partial<LocalCanvasState> | null,
        );

        if (!cancelled) {
          setIsInitialized(true);
        }
      }
    };

    bootstrap();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, roomSlug]);

  // For local mode we prefer to wait for initialization so we can show either
  // restored data or test elements. For room/file modes we render immediately
  // because live data (WebSocket or server props) may still be incoming.
  if (mode === "local" && !isInitialized) {
    return (
      <div className="relative w-full h-full flex items-center justify-center">
        <div className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-muted-foreground shadow-sm">
          Loading canvas…
        </div>
      </div>
    );
  }

  return (
    <RoughCanvas roomSlug={mode === "room" ? roomSlug : null} theme={theme} />
  );
}
