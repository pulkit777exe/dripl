'use client';

import { useEffect, useCallback, useRef } from 'react';
import { useCanvasStore } from '@/lib/canvas-store';
import { smoothZoom, normalizeWheelDelta } from '@/utils/zoomUtils';

interface MomentumRef {
  isInertial: boolean;
  velocityX: number;
  velocityY: number;
  lastX: number;
  lastY: number;
  lastTime: number;
  animationFrame: number;
}

interface UseCanvasWheelOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  containerReady: boolean;
}

export function useCanvasWheel({ containerRef, containerReady }: UseCanvasWheelOptions) {
  const momentumRef = useRef<MomentumRef>({
    isInertial: false,
    velocityX: 0,
    velocityY: 0,
    lastX: 0,
    lastY: 0,
    lastTime: 0,
    animationFrame: 0,
  });

  const setPan = useCanvasStore(state => state.setPan);
  const setZoom = useCanvasStore(state => state.setZoom);

  const stopMomentum = useCallback(() => {
    const m = momentumRef.current;
    if (m.animationFrame) {
      cancelAnimationFrame(m.animationFrame);
      m.animationFrame = 0;
    }
    m.isInertial = false;
    m.velocityX = 0;
    m.velocityY = 0;
  }, []);

  const applyMomentumRef = useRef<() => void>(() => {});

  const applyMomentum = useCallback(() => {
    const m = momentumRef.current;
    if (!m.isInertial) return;

    const decay = 0.95;
    const minVelocity = 0.5;

    m.velocityX *= decay;
    m.velocityY *= decay;

    if (Math.abs(m.velocityX) < minVelocity && Math.abs(m.velocityY) < minVelocity) {
      stopMomentum();
      return;
    }

    const state = useCanvasStore.getState();
    setPan(state.panX + m.velocityX, state.panY + m.velocityY);

    m.animationFrame = requestAnimationFrame(applyMomentumRef.current);
  }, [setPan, stopMomentum]);

  applyMomentumRef.current = applyMomentum;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let isTrackpad = false;
    let wheelTimer: ReturnType<typeof setTimeout> | null = null;

    const handleWheel = (e: WheelEvent) => {
      const isCtrlOrMeta = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;
      const absDx = Math.abs(e.deltaX);
      const absDy = Math.abs(e.deltaY);

      if (!isCtrlOrMeta) {
        if (wheelTimer) clearTimeout(wheelTimer);
        isTrackpad = absDx > 0 || absDy > 0;
        wheelTimer = setTimeout(() => {
          isTrackpad = false;
        }, 150);
      }

      // Two-finger trackpad pan
      if (!isCtrlOrMeta && (absDx > 2 || absDy > 2)) {
        e.preventDefault();
        const state = useCanvasStore.getState();
        const { dx, dy } = normalizeWheelDelta(e);

        const deltaX = -dx * 1.5;
        const deltaY = -dy * 1.5;

        if (isTrackpad || absDx > 5 || absDy > 5) {
          const now = performance.now();
          const m = momentumRef.current;

          if (m.isInertial) {
            m.velocityX = m.velocityX * 0.7 + deltaX * 0.3;
            m.velocityY = m.velocityY * 0.7 + deltaY * 0.3;
          } else {
            m.velocityX = deltaX;
            m.velocityY = deltaY;
          }

          m.isInertial = true;
          m.lastTime = now;

          if (!m.animationFrame) {
            m.animationFrame = requestAnimationFrame(applyMomentumRef.current);
          }
        } else {
          stopMomentum();
          setPan(state.panX + deltaX, state.panY + deltaY);
        }
        return;
      }

      // Ctrl/Cmd + scroll = zoom
      if (isCtrlOrMeta) {
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        const state = useCanvasStore.getState();
        const { dy } = normalizeWheelDelta(e);
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const worldX = (screenX - state.panX) / state.zoom;
        const worldY = (screenY - state.panY) / state.zoom;
        const factor = dy > 0 ? 0.9 : 1.1;
        const nextZoom = Math.max(0.1, Math.min(20, state.zoom * factor));
        const nextPanX = screenX - worldX * nextZoom;
        const nextPanY = screenY - worldY * nextZoom;
        smoothZoom(nextZoom, nextPanX, nextPanY, setZoom, setPan);
        return;
      }

      // Shift + scroll = horizontal pan
      if (isShift && (e.deltaX !== 0 || e.deltaY !== 0)) {
        e.preventDefault();
        const state = useCanvasStore.getState();
        const { dx, dy } = normalizeWheelDelta(e);
        setPan(state.panX - dx * 1.5, state.panY - dy * 1.5);
        return;
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
      stopMomentum();
      if (wheelTimer) clearTimeout(wheelTimer);
    };
  }, [containerRef, containerReady, setPan, setZoom, stopMomentum]);

  return { stopMomentum };
}
