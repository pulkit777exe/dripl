'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { DriplElement } from '@dripl/common';
import { CanvasBootstrap } from '@/components/canvas/CanvasBootstrap';
import { CanvasToolbar } from '@/components/canvas/CanvasToolbar';
import { CanvasControls } from '@/components/canvas/CanvasControls';
import { TopBar } from '@/components/canvas/TopBar';
import { useTheme } from '@/hooks/useTheme';
import { useAuth } from '@/app/context/AuthContext';
import { useCanvasStore } from '@/lib/store';
import { apiClient } from '@/lib/api';
import { generateThumbnail } from '@/utils/export';
import { HelpCircle, ShieldCheck } from 'lucide-react';
import HelpModal from '@/components/canvas/HelpModal';
import type { LocalCanvasState } from '@/utils/localCanvasStorage';

const CommandPalette = dynamic(
  () => import('@/components/canvas/CommandPalette').then(m => m.CommandPalette),
  { ssr: false }
);

export type FileInitialData = {
  elements: DriplElement[];
  appState: Partial<LocalCanvasState> | null;
};

const AUTOSAVE_DEBOUNCE_MS = 800;
const CONFLICT_MESSAGE =
  'This file changed elsewhere. Reload it before saving over the newer version.';

/**
 * Browsers cap `fetch(..., { keepalive: true })` at 64 KiB. Above that the
 * request rejects immediately, so a pagehide flush falls back to an ordinary
 * request rather than pretending the keepalive was sent.
 */
const KEEPALIVE_BODY_LIMIT = 60_000;

type Viewport = { zoom: number; panX: number; panY: number };

/**
 * The full autosave-relevant scene. The no-op comparison uses this so a pan or
 * zoom is a real change; conflict detection separately compares elements only,
 * because the viewport is not part of the server's conflict fence.
 */
function sceneSnapshot(elements: DriplElement[], viewport: Viewport): string {
  return JSON.stringify({ elements, appState: viewport });
}

function isSameViewport(a: Viewport | null, b: Viewport): boolean {
  return a !== null && a.zoom === b.zoom && a.panX === b.panX && a.panY === b.panY;
}

/**
 * Keep the optimistic fence monotonic. A save response can be older than a
 * fence another response already observed (for example, a keepalive flush that
 * committed just before an external write). Replacing the newer fence with the
 * older one would make the next save report a conflict that is already known.
 * ISO timestamps from the database sort chronologically, but parse them so a
 * malformed value cannot silently win.
 */
function laterUpdatedAt(current: string | null, next: string): string {
  if (current === null) return next;
  const currentMs = Date.parse(current);
  const nextMs = Date.parse(next);
  return Number.isFinite(currentMs) && Number.isFinite(nextMs) && nextMs < currentMs
    ? current
    : next;
}

/**
 * The interactive half of a saved canvas.
 *
 * `app/file/[id]/page.tsx` fetches the file on the server and hands the scene
 * over in `initialData`, which is the one thing here that used to cost a full
 * browser round trip after hydration. Autosave, conflict detection, thumbnails
 * and the Zustand wiring all stay on the client: they are per-keystroke,
 * per-conflict and per-frame concerns that a server render could not own, and
 * `fileUpdatedAtRef` below is the optimistic-concurrency token that only makes
 * sense in the browser's own timeline.
 *
 * The page used to render a centred `<Spinner/>` for the whole of the fetch.
 * The canvas chrome is now server-rendered markup and the scene is applied as
 * soon as the store mounts, so the toolbar, top bar and controls are on screen
 * before a single canvas chunk is requested.
 */
export function FileCanvasRoute({
  fileId,
  fileName,
  updatedAt,
  initialData,
}: {
  fileId: string;
  fileName: string;
  updatedAt: string;
  initialData: FileInitialData;
}) {
  const { effectiveTheme } = useTheme();
  const { user } = useAuth();
  const setUserId = useCanvasStore(state => state.setUserId);
  const setFileMetadata = useCanvasStore(state => state.setFileMetadata);

  const [saveError, setSaveError] = useState<string | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  /*
   * Scene and save state live in refs, not render state. Elements and the
   * viewport change on every frame of a drag or pan; selecting them here would
   * re-render the toolbar, top bar and controls each frame for a decision the
   * autosave path can make from a store subscription alone. The canvas already
   * renders from its own subscriptions.
   */
  const hydratedRef = useRef(false);
  const sceneLoadedRef = useRef(false);
  const fileIdRef = useRef(fileId);
  fileIdRef.current = fileId;
  const userRef = useRef(user);
  userRef.current = user;
  const saveErrorRef = useRef(saveError);
  saveErrorRef.current = saveError;
  const mountedRef = useRef(true);

  const lastSavedElementsRef = useRef<string | null>(null);
  const lastSavedSnapshotRef = useRef<string | null>(null);
  const lastThumbnailElementsRef = useRef<string | null>(null);
  const observedElementsRef = useRef<DriplElement[] | null>(null);
  const observedViewportRef = useRef<Viewport | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef(false);
  const fileUpdatedAtRef = useRef<string | null>(updatedAt);
  const saveConflictRef = useRef(false);
  const editGenerationRef = useRef(0);
  const appliedGenerationRef = useRef(0);
  // Invalidates responses from a previous load of the same file. The file id
  // alone is not enough: a reset or a re-applied scene can reuse it while an
  // older save is still in flight.
  const saveEpochRef = useRef(0);
  const inFlightRef = useRef(false);
  const performSaveRef = useRef<() => void>(() => {});

  useEffect(() => {
    // Clear the gate before touching the store: on a client-side navigation the
    // previous file's subscription is still installed for the rest of this
    // effect, and must not read the reset as a user edit.
    saveEpochRef.current += 1;
    hydratedRef.current = false;
    sceneLoadedRef.current = false;
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    const store = useCanvasStore.getState();
    store.setElements([], { skipHistory: true });
    store.clearHistory();
    store.clearSelection();
    store.setClipboard([]);
    setFileMetadata(fileId, fileName);

    observedElementsRef.current = null;
    observedViewportRef.current = null;
    lastSavedElementsRef.current = null;
    lastSavedSnapshotRef.current = null;
    lastThumbnailElementsRef.current = null;
    pendingSaveRef.current = false;
    editGenerationRef.current = 0;
    appliedGenerationRef.current = 0;
    inFlightRef.current = false;
    fileUpdatedAtRef.current = updatedAt;
    saveConflictRef.current = false;
    setSaveError(null);

    hydratedRef.current = true;
  }, [fileId, fileName, setFileMetadata, updatedAt]);

  // Auth resolves after the server-rendered file has already mounted. Keep the
  // user stamp in its own effect so that a null -> user transition cannot run
  // the reset above and wipe the scene the bootstrap just loaded.
  useEffect(() => {
    if (user) setUserId(user.id);
  }, [user, setUserId]);

  /**
   * The file scene has been applied to the store.
   *
   * This is the only place a save baseline is taken. The store is empty until
   * `CanvasBootstrap`'s asynchronous load lands; baselining from the store on
   * the first render records `[]`, then treats the loaded scene as an edit and
   * writes it straight back (and bumps `updatedAt` against any other tab).
   */
  const handleSceneLoaded = useCallback(() => {
    if (!mountedRef.current || !hydratedRef.current) return;
    const state = useCanvasStore.getState();
    if (state.fileId !== fileIdRef.current) return;

    saveEpochRef.current += 1;
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    inFlightRef.current = false;
    const viewport: Viewport = { zoom: state.zoom, panX: state.panX, panY: state.panY };
    observedElementsRef.current = state.elements;
    observedViewportRef.current = viewport;
    lastSavedElementsRef.current = JSON.stringify(state.elements);
    lastSavedSnapshotRef.current = sceneSnapshot(state.elements, viewport);
    lastThumbnailElementsRef.current = JSON.stringify(state.elements);
    editGenerationRef.current = 0;
    appliedGenerationRef.current = 0;
    pendingSaveRef.current = false;
    sceneLoadedRef.current = true;
  }, []);

  const armAutosave = useCallback(() => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      performSaveRef.current();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, []);

  /**
   * Save one snapshot of the scene.
   *
   * Saves are serialized: a timer that fires while a PATCH is in flight leaves
   * `pendingSaveRef` set and returns, and the in-flight completion re-arms the
   * debounce. Two overlapping saves would race the optimistic fence and let an
   * older response move `updatedAt` backwards.
   */
  const performSave = useCallback(() => {
    if (!hydratedRef.current || !sceneLoadedRef.current || !userRef.current) return;
    if (saveErrorRef.current || saveConflictRef.current) return;

    const saveFileId = fileId;
    if (fileIdRef.current !== saveFileId) return;

    const state = useCanvasStore.getState();
    if (state.fileId !== saveFileId) return;

    const elementsToSave = state.elements;
    const viewport: Viewport = { zoom: state.zoom, panX: state.panX, panY: state.panY };
    const snapshot = sceneSnapshot(elementsToSave, viewport);

    if (snapshot === lastSavedSnapshotRef.current) {
      pendingSaveRef.current = false;
      return;
    }
    if (inFlightRef.current) {
      pendingSaveRef.current = true;
      return;
    }

    const generation = editGenerationRef.current;
    const saveEpoch = saveEpochRef.current;
    inFlightRef.current = true;
    let succeeded = false;

    const isCurrentSave = () =>
      mountedRef.current && fileIdRef.current === saveFileId && saveEpochRef.current === saveEpoch;

    const currentSnapshot = () => {
      const current = useCanvasStore.getState();
      if (current.fileId !== saveFileId) return null;
      return sceneSnapshot(current.elements, {
        zoom: current.zoom,
        panX: current.panX,
        panY: current.panY,
      });
    };

    const scheduleThumbnail = (elementsSaved: DriplElement[], savedGeneration: number) => {
      if (!isCurrentSave() || savedGeneration !== appliedGenerationRef.current) return;
      const elementsJson = JSON.stringify(elementsSaved);
      if (elementsJson === lastThumbnailElementsRef.current) return;
      lastThumbnailElementsRef.current = elementsJson;

      generateThumbnail(elementsSaved)
        .then(thumbnail => {
          if (!thumbnail || !isCurrentSave()) return;
          if (savedGeneration !== appliedGenerationRef.current) return;
          return apiClient
            .updateFile(saveFileId, {
              preview: thumbnail,
              expectedUpdatedAt: fileUpdatedAtRef.current ?? undefined,
            })
            .then(result => {
              if (!isCurrentSave()) return;
              if (savedGeneration !== appliedGenerationRef.current) return;
              fileUpdatedAtRef.current = laterUpdatedAt(
                fileUpdatedAtRef.current,
                result.file.updatedAt
              );
            })
            .catch(() => {});
        })
        .catch(() => {});
    };

    const applySaved = (
      nextUpdatedAt: string,
      elementsSaved: DriplElement[],
      savedSnapshot: string,
      savedGeneration: number
    ) => {
      if (!isCurrentSave()) return;
      if (savedGeneration < appliedGenerationRef.current) {
        // A newer save landed first; replaying this response would move the
        // fence and the baseline back to older content.
        const latest = currentSnapshot();
        pendingSaveRef.current =
          latest !== null &&
          lastSavedSnapshotRef.current !== null &&
          latest !== lastSavedSnapshotRef.current;
        return;
      }

      appliedGenerationRef.current = savedGeneration;
      fileUpdatedAtRef.current = laterUpdatedAt(fileUpdatedAtRef.current, nextUpdatedAt);
      lastSavedElementsRef.current = JSON.stringify(elementsSaved);
      lastSavedSnapshotRef.current = savedSnapshot;

      const latest = currentSnapshot();
      pendingSaveRef.current = latest !== null && latest !== savedSnapshot;
      setSaveError(null);
      scheduleThumbnail(elementsSaved, savedGeneration);
    };

    const saveContent = (
      elements: DriplElement[],
      appState: Viewport,
      expectedUpdatedAt?: string
    ) =>
      apiClient.updateFile(saveFileId, {
        content: { elements, appState },
        expectedUpdatedAt,
      });

    void (async () => {
      try {
        const saved = await saveContent(
          elementsToSave,
          viewport,
          fileUpdatedAtRef.current ?? undefined
        );
        if (!isCurrentSave()) return;
        succeeded = true;
        applySaved(saved.file.updatedAt, elementsToSave, snapshot, generation);
      } catch (error) {
        if (!isCurrentSave()) return;
        const status =
          typeof error === 'object' && error !== null
            ? (error as { status?: unknown }).status
            : undefined;
        const message = error instanceof Error ? error.message : 'Failed to save canvas';
        if (status === 409 || message.toLowerCase().includes('changed while saving')) {
          try {
            const latest = await apiClient.getFile(saveFileId);
            if (!isCurrentSave()) return;
            fileUpdatedAtRef.current = laterUpdatedAt(
              fileUpdatedAtRef.current,
              latest.file.updatedAt
            );
            const latestContent = JSON.stringify(elementsFromFileContent(latest.file.content));
            // A retry is safe only when the server's scene still matches the
            // base we loaded. Otherwise a human must choose/rebase the two
            // scenes; silently overwriting either side is data loss.
            if (latestContent === lastSavedElementsRef.current) {
              // Retry the latest local state, not the snapshot the timer
              // captured: edits may have arrived while the 409 was being read.
              const retryState = useCanvasStore.getState();
              if (retryState.fileId !== saveFileId) return;
              const retryElements = retryState.elements;
              const retryViewport: Viewport = {
                zoom: retryState.zoom,
                panX: retryState.panX,
                panY: retryState.panY,
              };
              const retrySnapshot = sceneSnapshot(retryElements, retryViewport);
              if (retrySnapshot === lastSavedSnapshotRef.current) {
                succeeded = true;
                pendingSaveRef.current = false;
                setSaveError(null);
                return;
              }
              const retryGeneration = editGenerationRef.current;
              // Use the freshest fence: a keepalive flush may have committed
              // after the `getFile` above and advanced it. The fetched
              // `latest.file.updatedAt` would then be a guaranteed 409.
              const retried = await saveContent(
                retryElements,
                retryViewport,
                fileUpdatedAtRef.current ?? undefined
              );
              if (!isCurrentSave()) return;
              succeeded = true;
              applySaved(retried.file.updatedAt, retryElements, retrySnapshot, retryGeneration);
              return;
            }
            saveConflictRef.current = true;
            pendingSaveRef.current = false;
            setSaveError(CONFLICT_MESSAGE);
          } catch {
            if (!isCurrentSave()) return;
            saveConflictRef.current = true;
            pendingSaveRef.current = false;
            setSaveError(CONFLICT_MESSAGE);
          }
          return;
        }
        pendingSaveRef.current = true;
        setSaveError(message);
      } finally {
        if (isCurrentSave()) {
          inFlightRef.current = false;
          if (succeeded && pendingSaveRef.current && !saveConflictRef.current) {
            armAutosave();
          }
        }
      }
    })();
  }, [armAutosave, fileId]);

  performSaveRef.current = performSave;

  /**
   * Observe elements and the viewport without re-rendering this route. The
   * debounce and the full JSON comparison stay out of the subscription: this
   * runs on every store commit, and stringifying a large scene per frame is
   * exactly the cost the old deferred comparison existed to avoid.
   */
  const noteContentChange = useCallback(
    (state: ReturnType<typeof useCanvasStore.getState>) => {
      if (!hydratedRef.current || !sceneLoadedRef.current) return;
      if (!userRef.current || saveErrorRef.current || saveConflictRef.current) return;
      if (state.fileId !== fileIdRef.current) return;

      const viewport: Viewport = { zoom: state.zoom, panX: state.panX, panY: state.panY };
      if (
        state.elements === observedElementsRef.current &&
        isSameViewport(observedViewportRef.current, viewport)
      ) {
        return;
      }

      observedElementsRef.current = state.elements;
      observedViewportRef.current = viewport;
      editGenerationRef.current += 1;
      pendingSaveRef.current = true;
      armAutosave();
    },
    [armAutosave]
  );

  useEffect(() => useCanvasStore.subscribe(noteContentChange), [noteContentChange]);

  // If the user was signed out while the scene loaded, edits made before auth
  // resolved were ignored above. Retry once the user arrives rather than
  // waiting for another edit to notice them.
  useEffect(() => {
    if (user) noteContentChange(useCanvasStore.getState());
  }, [user, noteContentChange]);

  const flushPendingSave = useCallback((keepalive: boolean) => {
    if (!mountedRef.current || !hydratedRef.current || !sceneLoadedRef.current) return;
    if (!userRef.current || saveConflictRef.current) return;

    const saveFileId = fileIdRef.current;
    const state = useCanvasStore.getState();
    if (state.fileId !== saveFileId) return;

    const viewport: Viewport = { zoom: state.zoom, panX: state.panX, panY: state.panY };
    const snapshot = sceneSnapshot(state.elements, viewport);
    if (snapshot === lastSavedSnapshotRef.current) {
      pendingSaveRef.current = false;
      return;
    }

    const body = {
      content: { elements: state.elements, appState: viewport },
      expectedUpdatedAt: fileUpdatedAtRef.current ?? undefined,
    };
    const flushEpoch = saveEpochRef.current;
    const flushGeneration = editGenerationRef.current;
    const flushElements = state.elements;
    const isCurrentFlush = () =>
      mountedRef.current && fileIdRef.current === saveFileId && saveEpochRef.current === flushEpoch;

    pendingSaveRef.current = true;
    // `keepalive` caps the whole request at 64 KiB. Measure UTF-8 bytes, not
    // UTF-16 code units: text full of emoji or CJK characters is up to 4x
    // larger than `.length` suggests.
    const serialized = JSON.stringify(body);
    const useKeepalive =
      keepalive && new TextEncoder().encode(serialized).length <= KEEPALIVE_BODY_LIMIT;
    void apiClient
      .updateFile(saveFileId, body, useKeepalive ? { keepalive: true } : undefined)
      .then(result => {
        // A hidden tab that comes back must not treat the next edit as a
        // conflict: the flush did save, so advance the same baseline and fence
        // a normal save would have advanced.
        if (!isCurrentFlush()) return;
        if (flushGeneration < appliedGenerationRef.current) return;
        // A 409 handler may have observed a newer fence while this flush was
        // in flight. Its response describes a state the server has already
        // left; adopting it would let the next edit overwrite that newer state
        // without noticing.
        if (
          laterUpdatedAt(fileUpdatedAtRef.current, result.file.updatedAt) !== result.file.updatedAt
        ) {
          return;
        }
        appliedGenerationRef.current = flushGeneration;
        fileUpdatedAtRef.current = result.file.updatedAt;
        lastSavedElementsRef.current = JSON.stringify(flushElements);
        lastSavedSnapshotRef.current = snapshot;
        const current = useCanvasStore.getState();
        const latest =
          current.fileId === saveFileId
            ? sceneSnapshot(current.elements, {
                zoom: current.zoom,
                panX: current.panX,
                panY: current.panY,
              })
            : null;
        pendingSaveRef.current = latest !== null && latest !== snapshot;
        // The flush covered everything now on screen, so an earlier conflict
        // about this fence is resolved. A newer edit still leaves the banner
        // up: it has not been saved.
        if (latest === snapshot) {
          saveConflictRef.current = false;
          setSaveError(null);
        }
      })
      .catch(() => {});
  }, []);

  // A hard reload or tab close does not run React's effect cleanup, so the
  // debounced save would be discarded with the document. `pagehide` and a
  // hidden document flush with keepalive instead. The CSRF token is warmed on
  // mount because the request path cannot await a token fetch while the page
  // is being torn down.
  useEffect(() => {
    void apiClient.getCsrfToken().catch(() => {});
  }, []);

  useEffect(() => {
    const onPageHide = () => flushPendingSave(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushPendingSave(true);
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [flushPendingSave]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      // SPA navigation: the document is still alive, so an ordinary request is
      // enough. The store still holds this file's scene; the next route has not
      // mounted yet.
      flushPendingSave(false);
      mountedRef.current = false;
    };
  }, [flushPendingSave]);

  return (
    <div
      className={`w-screen h-dvh relative overflow-hidden ${effectiveTheme === 'dark' ? 'bg-[#121112]' : 'bg-[#f7f5f6]'}`}
    >
      <TopBar />
      {saveError && (
        <div className="absolute left-1/2 top-14 z-40 -translate-x-1/2 rounded-md border border-[#F5C2B8] bg-[#FDF2F0] px-3 py-1.5 text-[12px] text-[#8B2A1A]">
          <span>{saveError}</span>
          {saveError.startsWith('This file changed elsewhere') && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="ml-2 font-semibold underline"
            >
              Reload
            </button>
          )}
        </div>
      )}
      <CanvasBootstrap
        mode="file"
        initialData={{ elements: initialData.elements, appState: initialData.appState }}
        theme={effectiveTheme}
        replaceExisting
        onSceneLoaded={handleSceneLoaded}
      />
      <div className="absolute top-0.5 left-1/2 -translate-x-1/2 z-20">
        <CanvasToolbar />
      </div>
      <div className="absolute bottom-6 left-6 z-20">
        <CanvasControls />
      </div>

      <div className="absolute bottom-6 right-6 z-20 flex gap-2 pointer-events-auto">
        <button
          type="button"
          onClick={() => setIsHelpOpen(true)}
          className="canvas-chrome-btn size-10"
          aria-label="Help"
        >
          <HelpCircle className="mx-2" />
        </button>
        <span
          className="canvas-chrome-btn size-10"
          aria-label="Verification status"
          title="Verified"
          role="status"
        >
          <ShieldCheck className="mx-2" />
        </span>
      </div>

      <CommandPalette />
      <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
    </div>
  );
}

function elementsFromFileContent(rawContent: unknown): DriplElement[] {
  if (Array.isArray(rawContent)) return rawContent as DriplElement[];
  if (rawContent && typeof rawContent === 'object') {
    const content = rawContent as { elements?: unknown };
    if (Array.isArray(content.elements)) return content.elements as DriplElement[];
  }
  return [];
}
