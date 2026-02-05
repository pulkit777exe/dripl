"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DriplElement } from "@dripl/common";

import RoughCanvas from "@/components/canvas/RoughCanvas";
import { useCanvasStore } from "@/lib/canvas-store";
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

  const setElements = useCanvasStore((state) => state.setElements);
  const existingElements = useCanvasStore((state) => state.elements);

  const [isInitialized, setIsInitialized] = useState(false);

  // Capture the initial elements only once so we can decide later whether
  // to prompt before overwriting them with an external scene.
  const initialElementsRef = useRef<DriplElement[] | null>(null);
  if (initialElementsRef.current === null) {
    initialElementsRef.current = existingElements;
  }

  const mode = props.mode;

  const roomSlug = useMemo(
    () => (mode === "room" ? props.roomSlug : null),
    [mode, props],
  );

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      if (mode === "local") {
        const { elements, appState } = loadLocalCanvasFromStorage();

        const initialElements = elements as DriplElement[] | null;

        if (initialElements && initialElements.length > 0) {
          setElements(initialElements);
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
          const shouldOverride = window.confirm(
            "Replace the current canvas with the contents of this file?",
          );

          if (!shouldOverride) {
            setIsInitialized(true);
            return;
          }
        }

        if (scene.elements.length > 0) {
          setElements(scene.elements);
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
    <RoughCanvas
      roomSlug={mode === "room" ? roomSlug : null}
      theme={theme}
    />
  );
}

