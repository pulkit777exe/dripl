'use client';

import React, { useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Menu as MenuIcon } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useCanvasStore } from '@/lib/store';
import { useTopBarFileOps } from '@/hooks/useTopBarFileOps';
import { Menu } from './Menu';

const ShareModal = dynamic(() => import('./ShareModal').then(m => m.ShareModal), { ssr: false });
export const TopBar: React.FC = () => {
  const { user } = useAuth();
  const router = useRouter();
  const fileId = useCanvasStore(state => state.fileId);

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setIsMenuOpen(false), []);
  const { handleResetCanvas, handleSaveToFile, handleOpenFile, handleExportImage } =
    useTopBarFileOps({ onActionDone: closeMenu });
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const isConnected = useCanvasStore(state => state.isConnected);
  const roomId = useCanvasStore(state => state.roomId);
  const remoteUsers = useCanvasStore(state => state.remoteUsers);

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
    const elements = useCanvasStore.getState().elements;
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
      // eslint-disable-next-line no-console -- share-link failure telemetry
      console.error('Failed to share canvas snapshot:', error);
      setShareErrorMessage('Failed to create share link. Please try again.');
    }
  }, [clearShareMessages]);

  const handleCollaborate = useCallback(async () => {
    clearShareMessages();
    try {
      const elementsJson = JSON.stringify(useCanvasStore.getState().elements);
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
      router.push(`/room/${payload.roomId}`);
    } catch (error) {
      // eslint-disable-next-line no-console -- collaboration bootstrap failure telemetry
      console.error('Failed to start collaboration:', error);
      setShareErrorMessage('Failed to start collaboration. Please try again.');
    }
  }, [clearShareMessages, router]);

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
        fileId={fileId ?? ''}
        onShareCanvas={handleShareCanvas}
        onCollaborate={handleCollaborate}
        onStopCollaboration={handleLeaveSession}
        feedbackMessage={shareFeedbackMessage}
        errorMessage={shareErrorMessage}
        isCollaborating={isConnected}
        roomId={roomId}
        collaborators={Array.from(remoteUsers.values())}
      />
    </>
  );
};
