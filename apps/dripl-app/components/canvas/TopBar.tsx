'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Menu as MenuIcon } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useCanvasStore } from '@/lib/canvas-store';
import { Menu } from './Menu';
import { ShareModal } from './ShareModal';
import { CanvasContentSchema, type DriplElement } from '@dripl/common';
import { downloadBlob, exportCanvas } from '@/utils/export';

export const TopBar: React.FC = () => {
  const { user } = useAuth();
  const router = useRouter();
  const elements = useCanvasStore(state => state.elements);
  const fileId = useCanvasStore(state => state.fileId);
  const zoom = useCanvasStore(state => state.zoom);
  const panX = useCanvasStore(state => state.panX);
  const panY = useCanvasStore(state => state.panY);
  const gridEnabled = useCanvasStore(state => state.gridEnabled);
  const gridSize = useCanvasStore(state => state.gridSize);
  const theme = useCanvasStore(state => state.theme);
  const fileName = useCanvasStore(state => state.fileName);
  const setElements = useCanvasStore(state => state.setElements);
  const setPan = useCanvasStore(state => state.setPan);
  const setZoom = useCanvasStore(state => state.setZoom);
  const setGridEnabled = useCanvasStore(state => state.setGridEnabled);
  const setGridSize = useCanvasStore(state => state.setGridSize);
  const setSelectedIds = useCanvasStore(state => state.setSelectedIds);
  const setTheme = useCanvasStore(state => state.setTheme);
  const setFileMetadata = useCanvasStore(state => state.setFileMetadata);

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const isConnected = useCanvasStore(state => state.isConnected);

  const handleLeaveSession = useCallback(() => {
    useCanvasStore.getState().setShouldLeaveRoom(true);
    router.push('/canvas');
  }, [router]);
  const [shareFeedbackMessage, setShareFeedbackMessage] = useState<string | null>(null);
  const [shareErrorMessage, setShareErrorMessage] = useState<string | null>(null);
  const [activeLanguage, setActiveLanguage] = useState('en');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem('dripl-language') || 'en';
    setActiveLanguage(stored);
    document.documentElement.lang = stored;
  }, []);

  const handleDriplPlusClick = () => {
    if (!user) {
      router.push('/login?next=/settings/plan');
      return;
    }

    router.push('/settings/plan');
  };

  const clearShareMessages = useCallback(() => {
    setShareFeedbackMessage(null);
    setShareErrorMessage(null);
  }, []);

  const handleShareCanvas = useCallback(async () => {
    clearShareMessages();
    if (elements.length === 0) {
      setShareErrorMessage('Nothing to share yet — draw something first.');
      return;
    }
    try {
      const response = await fetch('/api/canvas/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: JSON.stringify(elements) }),
      });
      if (!response.ok) throw new Error('Failed to create snapshot');
      const payload = (await response.json()) as { id: string };
      const url = `${window.location.origin}/canvas?snapshot=${payload.id}`;
      await navigator.clipboard.writeText(url);
      setShareFeedbackMessage('Link copied!');
    } catch (error) {
      console.error('Failed to share canvas snapshot:', error);
      setShareErrorMessage('Failed to create share link. Please try again.');
    }
  }, [clearShareMessages, elements]);

  const handleCollaborate = useCallback(async () => {
    clearShareMessages();
    try {
      const elementsJson = JSON.stringify(elements);
      const response = await fetch('/api/canvas/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: elementsJson }),
      });
      if (response.status === 401) {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        router.push(`/login?next=${next}`);
        return;
      }
      if (!response.ok) throw new Error('Failed to create room');
      const payload = (await response.json()) as { roomId: string };
      const url = `${window.location.origin}/canvas/${payload.roomId}`;
      await navigator.clipboard.writeText(url);
      setShareFeedbackMessage('Link copied!');
      setIsShareModalOpen(false);
      router.push(`/canvas/${payload.roomId}`);
    } catch (error) {
      console.error('Failed to start collaboration:', error);
      setShareErrorMessage('Failed to start collaboration. Please try again.');
    }
  }, [clearShareMessages, elements, router]);

  const handleResetCanvas = () => {
    if (confirm('Are you sure you want to reset the canvas? This cannot be undone.')) {
      useCanvasStore.getState().setElements([]);
    }
    setIsMenuOpen(false);
  };

  const handleSaveToFile = () => {
    const payload = {
      version: 1,
      type: 'dripl-scene',
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
      type: 'application/json',
    });
    const safeName = (fileName || 'untitled').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
    downloadBlob(blob, `${safeName || 'untitled'}.dripl`);
    setIsMenuOpen(false);
  };

  const handleOpenFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.dripl,application/json';
    input.onchange = async event => {
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
              theme?: 'light' | 'dark' | 'system';
            }
          | undefined;

        if (Array.isArray(parsed)) {
          importedElements = CanvasContentSchema.parse(parsed) as DriplElement[];
        } else if (parsed && typeof parsed === 'object' && 'elements' in parsed) {
          const scene = parsed as {
            elements?: unknown;
            appState?: {
              zoom?: number;
              panX?: number;
              panY?: number;
              gridEnabled?: boolean;
              gridSize?: number;
              theme?: 'light' | 'dark' | 'system';
            };
          };
          importedElements = CanvasContentSchema.parse(scene.elements ?? []) as DriplElement[];
          importedAppState = scene.appState;
        } else {
          throw new Error('Invalid .dripl file format');
        }

        setElements(importedElements);
        setSelectedIds(new Set<string>());
        if (importedAppState) {
          if (typeof importedAppState.zoom === 'number') setZoom(importedAppState.zoom);
          if (
            typeof importedAppState.panX === 'number' &&
            typeof importedAppState.panY === 'number'
          ) {
            setPan(importedAppState.panX, importedAppState.panY);
          }
          if (typeof importedAppState.gridEnabled === 'boolean') {
            setGridEnabled(importedAppState.gridEnabled);
          }
          if (typeof importedAppState.gridSize === 'number') {
            setGridSize(importedAppState.gridSize);
          }
          if (importedAppState.theme) {
            setTheme(importedAppState.theme);
          }
        }
        setFileMetadata(fileId, file.name.replace(/\.dripl$/i, ''));
      } catch (error) {
        console.error('Failed to open .dripl file:', error);
        alert('Could not open this file. Please choose a valid .dripl file.');
      }
    };
    input.click();
    setIsMenuOpen(false);
  };

  const handleExportImage = async () => {
    try {
      const blob = await Promise.resolve(
        exportCanvas('png', elements, {
          scale: 2,
          background: '#ffffff',
          padding: 16,
        })
      );
      downloadBlob(blob, `canvas-${Date.now()}.png`);
    } catch (error) {
      console.error('PNG export failed:', error);
      alert('Failed to export PNG image.');
    } finally {
      setIsMenuOpen(false);
    }
  };

  const handleFindOnCanvas = () => {
    const query = window.prompt('Find on canvas', '');
    if (!query || !query.trim()) return;
    window.dispatchEvent(
      new CustomEvent('dripl:find-on-canvas', {
        detail: { query: query.trim() },
      })
    );
    setIsMenuOpen(false);
  };

  const handleOpenCommandPalette = () => {
    window.dispatchEvent(new CustomEvent('dripl:open-command-palette'));
    setIsMenuOpen(false);
  };

  const handleOpenHelp = () => {
    window.dispatchEvent(new CustomEvent('dripl:open-help'));
    setIsMenuOpen(false);
  };

  const handleLanguageChange = (languageCode: string) => {
    setActiveLanguage(languageCode);
    localStorage.setItem('dripl-language', languageCode);
    document.documentElement.lang = languageCode;
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const cmdOrCtrl = event.metaKey || event.ctrlKey;
      if (!cmdOrCtrl) return;
      const key = event.key.toLowerCase();

      if (key === 'o') {
        event.preventDefault();
        handleOpenFile();
        return;
      }

      if (key === 's') {
        event.preventDefault();
        handleSaveToFile();
        return;
      }

      if (key === 'e' && event.shiftKey) {
        event.preventDefault();
        void handleExportImage();
        return;
      }

      if (key === '/') {
        event.preventDefault();
        handleOpenCommandPalette();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleExportImage, handleOpenCommandPalette, handleOpenFile, handleSaveToFile]);

  return (
    <>
      <div className="absolute top-4 left-4 z-40 flex gap-2 pointer-events-auto">
        <button
          className="canvas-chrome-btn p-2.5"
          onClick={e => {
            e.stopPropagation();
            setIsMenuOpen(!isMenuOpen);
          }}
          onMouseDown={e => e.stopPropagation()}
          aria-label="Open settings and options"
        >
          <MenuIcon size={20} />
        </button>
      </div>

      <div className="absolute top-4 right-4 z-40 flex items-center gap-2.5 pointer-events-auto">
        <button
          className="canvas-chrome-btn px-4 py-2 text-sm font-medium"
          onClick={handleDriplPlusClick}
          aria-label="Dripl plus"
        >
          Dripl+
        </button>

        <button
          className="canvas-chrome-btn-primary px-4 py-2 text-sm font-medium"
          onClick={e => {
            e.stopPropagation();
            setIsShareModalOpen(true);
          }}
          onMouseDown={e => e.stopPropagation()}
          aria-label="Share"
        >
          Share
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
        onClose={() => {
          setIsShareModalOpen(false);
          clearShareMessages();
        }}
        onShareCanvas={handleShareCanvas}
        onCollaborate={handleCollaborate}
        onStopCollaboration={handleLeaveSession}
        feedbackMessage={shareFeedbackMessage}
        errorMessage={shareErrorMessage}
        isCollaborating={isConnected}
      />
    </>
  );
};
