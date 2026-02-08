import type { DriplElement } from "@dripl/common";
import {
  loadLocalCanvasFromStorage,
  type LocalCanvasState,
} from "@/utils/localCanvasStorage";
import { loadCanvasFromIndexedDB } from "@/lib/canvas-db";

export type SceneSource = "local" | "room" | "file";

export interface LoadedScene {
  source: SceneSource;
  elements: DriplElement[];
  appState?: Partial<LocalCanvasState> | null;
  /**
   * Indicates that the scene came from a cache (localStorage/IndexedDB/file),
   * and may be superseded by a live collaboration source.
   */
  isFromCache?: boolean;
}

interface LoadLocalSceneOptions {
  source: "local";
}

interface LoadRoomSceneOptions {
  source: "room";
  roomId: string;
}

interface LoadFileSceneOptions {
  source: "file";
  initialData: unknown;
}

export type LoadSceneOptions =
  | LoadLocalSceneOptions
  | LoadRoomSceneOptions
  | LoadFileSceneOptions;

export async function loadInitialScene(
  options: LoadSceneOptions,
): Promise<LoadedScene | null> {
  switch (options.source) {
    case "local": {
      const { elements, appState } = loadLocalCanvasFromStorage();

      return {
        source: "local",
        elements: (elements as DriplElement[]) || [],
        appState: (appState as Partial<LocalCanvasState>) || null,
        isFromCache: true,
      };
    }

    case "room": {
      const elements = await loadCanvasFromIndexedDB(options.roomId);

      if (!elements.length) {
        return null;
      }

      return {
        source: "room",
        elements,
        appState: null,
        isFromCache: true,
      };
    }

    case "file": {
      const { initialData } = options;

      if (!initialData) {
        return null;
      }

      let elements: DriplElement[] = [];
      let appState: Partial<LocalCanvasState> | null = null;

      if (Array.isArray(initialData)) {
        elements = initialData as DriplElement[];
      } else if (typeof initialData === "object" && initialData !== null) {
        const data = initialData as {
          elements?: unknown;
          appState?: unknown;
        };

        if (Array.isArray(data.elements)) {
          elements = data.elements as DriplElement[];
        }

        if (data.appState && typeof data.appState === "object") {
          appState = data.appState as Partial<LocalCanvasState>;
        }
      }

      return {
        source: "file",
        elements,
        appState,
        isFromCache: true,
      };
    }

    default:
      return null;
  }
}
