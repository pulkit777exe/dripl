'use client';

import React, { useState, useCallback } from 'react';
import {
  Menu as MenuIcon,
  Library,
  Share2,
  MoreHorizontal,
  ArrowLeft,
  Check,
  X,
  Users,
} from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api/client';
import { useCanvasStore } from '@/lib/canvas-store';
import { Menu } from './Menu';
import { ShareModal } from './ShareModal';
import { CanvasContentSchema, type DriplElement } from '@dripl/common';
import { downloadBlob, exportCanvas } from '@/utils/export';
import HelpModal from './HelpModal';

export const TopBar: React.FC = () => {
  const { user, loading } = useAuth();
  const router = useRouter();
  const elements = useCanvasStore(state => state.elements);
  const fileId = useCanvasStore(state => state.fileId);
  const isConnected = useCanvasStore(state => state.isConnected);
  const roomSlug = useCanvasStore(state => state.roomSlug);
  const isSaving = useCanvasStore(state => state.isSaving);
  const lastSaved = useCanvasStore(state => state.lastSaved);
  const remoteUsers = useCanvasStore(state => state.remoteUsers);
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
  const [shareFeedbackMessage, setShareFeedbackMessage] = useState<string | null>(null);
  const [shareErrorMessage, setShareErrorMessage] = useState<string | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [activeLanguage, setActiveLanguage] = useState('en');
  const [isEditingName, setIsEditingName] = useState(false);
  const [roomName, setRoomName] = useState(fileName || 'Untitled Canvas');
  const [showCollaborators, setShowCollaborators] = useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem('dripl-language') || 'en';
    setActiveLanguage(stored);
    document.documentElement.lang = stored;
  }, []);

  React.useEffect(() => {
    if (fileName) setRoomName(fileName);
  }, [fileName]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '?' || (e.ctrlKey && e.key === '/')) {
        e.preventDefault();
        setIsHelpOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSaveRoomName = useCallback(async () => {
    if (!fileId || !roomName.trim()) return;
    try {
      await apiClient.updateFile(fileId, { name: roomName.trim() });
      setFileMetadata(fileId, roomName.trim());
    } catch (error) {
      console.error('Failed to update file name:', error);
    }
    setIsEditingName(false);
  }, [fileId, roomName, setFileMetadata]);

  const handleCancelEditName = useCallback(() => {
    setRoomName(fileName || 'Untitled Canvas');
    setIsEditingName(false);
  }, [fileName]);

  const handleDriplPlusClick = async () => {
    if (!user) {
      router.push('/auth/login');
      return;
    }

    try {
      const response = await apiClient.createFile({
        name: 'Untitled file',
        content: elements,
      });
      router.push(`/canvas/${response.id}`);
    } catch (error) {
      console.error('Failed to create file:', error);
      alert('Failed to create file. Please try again.');
    }
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
      const response = await fetch('/api/canvas/rooms', { method: 'POST' });
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
  }, [clearShareMessages, router]);

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
        setFileMetadata(null, file.name.replace(/\.dripl$/i, ''));
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
    setIsHelpOpen(true);
    setIsMenuOpen(false);
  };

  const handleLanguageChange = (languageCode: string) => {
    setActiveLanguage(languageCode);
    localStorage.setItem('dripl-language', languageCode);
    document.documentElement.lang = languageCode;
  };

  React.useEffect(() => {
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

  const saveStatusText = isSaving
    ? 'Saving...'
    : lastSaved
      ? `Saved ${new Date(lastSaved).toLocaleTimeString()}`
      : fileId
        ? 'Saved'
        : 'Unsaved changes';

  const collaboratorList = Array.from(remoteUsers.values());

  return (
    <>
      <div className="absolute top-4 left-4 z-100 flex gap-2 pointer-events-auto">
        <button
          className="p-2 rounded-md border border-toolbar-border bg-toolbar-bg hover:bg-tool-hover-bg text-foreground transition-colors duration-150"
          onClick={() => router.push('/dashboard')}
          onMouseDown={e => e.stopPropagation()}
          aria-label="Back to dashboard"
        >
          <ArrowLeft size={20} />
        </button>
        <button
          className="p-2 rounded-md border border-toolbar-border bg-toolbar-bg hover:bg-tool-hover-bg text-foreground transition-colors duration-150"
          onClick={e => {
            e.stopPropagation();
            setIsMenuOpen(!isMenuOpen);
          }}
          onMouseDown={e => e.stopPropagation()}
          aria-label="Open menu"
        >
          <MenuIcon size={20} />
        </button>

        <button
          className="p-2 rounded-md border border-toolbar-border bg-toolbar-bg hover:bg-tool-hover-bg text-foreground transition-colors duration-150"
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          aria-label="Library"
        >
          <Library size={20} />
        </button>
      </div>

      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-100 flex items-center gap-2 pointer-events-auto">
        {isEditingName ? (
          <div className="flex items-center gap-1 bg-toolbar-bg border border-toolbar-border rounded-lg px-2 py-1">
            <input
              value={roomName}
              onChange={e => setRoomName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSaveRoomName();
                if (e.key === 'Escape') handleCancelEditName();
              }}
              className="text-sm bg-transparent border-none outline-none text-foreground w-40"
              autoFocus
            />
            <button onClick={handleSaveRoomName} className="p-0.5 hover:bg-tool-hover-bg rounded">
              <Check className="h-3.5 w-3.5 text-green-500" />
            </button>
            <button onClick={handleCancelEditName} className="p-0.5 hover:bg-tool-hover-bg rounded">
              <X className="h-3.5 w-3.5 text-red-500" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsEditingName(true)}
            className="text-sm font-medium text-foreground px-3 py-1.5 rounded-lg hover:bg-toolbar-bg/80 transition-colors"
          >
            {roomName}
          </button>
        )}
        <span className="text-xs text-muted-foreground">{saveStatusText}</span>
      </div>

      <div className="absolute top-4 right-4 z-100 flex items-center gap-2 pointer-events-auto">
        {collaboratorList.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setShowCollaborators(!showCollaborators)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-toolbar-bg border border-toolbar-border text-sm text-foreground hover:bg-tool-hover-bg transition-colors"
            >
              <Users className="h-3.5 w-3.5" />
              <span>{collaboratorList.length + 1}</span>
            </button>
            {showCollaborators && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-popover border border-border rounded-lg shadow-lg py-1 z-10">
                <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground border-b border-border">
                  Collaborators
                </div>
                <div className="px-3 py-1.5 text-sm text-foreground flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  You
                </div>
                {collaboratorList.map(u => (
                  <div
                    key={u.userId}
                    className="px-3 py-1.5 text-sm text-foreground flex items-center gap-2"
                  >
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: u.color }} />
                    {u.userName}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {roomSlug !== null && (
          <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-green-500/10 text-green-500 text-xs">
            <div
              className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-amber-500'}`}
            />
            {isConnected ? 'Live' : 'Reconnecting...'}
          </div>
        )}
        <button
          className="px-4 py-1.5 bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 rounded-lg flex items-center gap-1.5 transition-opacity duration-150"
          onClick={e => {
            e.stopPropagation();
            setIsShareModalOpen(true);
          }}
          onMouseDown={e => e.stopPropagation()}
          aria-label="Share"
        >
          <Share2 size={14} />
          Share
        </button>
        <button
          className="p-2 rounded-md bg-toolbar-bg hover:bg-tool-hover-bg border border-toolbar-border text-foreground transition-colors duration-150"
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
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
        onClose={() => {
          setIsShareModalOpen(false);
          clearShareMessages();
        }}
        onShareCanvas={handleShareCanvas}
        onCollaborate={handleCollaborate}
        feedbackMessage={shareFeedbackMessage}
        errorMessage={shareErrorMessage}
      />
      {isHelpOpen && <HelpModal onClose={() => setIsHelpOpen(false)} />}
    </>
  );
};
