'use client';

import { useEffect, useRef } from 'react';
import { useCanvasStore } from '@/lib/store';
import { useLaserTrail } from '@/hooks/canvas/useLaserTrail';

const LASER_FADE_MS = 1000;

export function LaserCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const trail = useLaserTrail();
  const { points, isActive, prune } = trail;
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = parent.clientWidth * dpr;
      canvas.height = parent.clientHeight * dpr;
      canvas.style.width = `${parent.clientWidth}px`;
      canvas.style.height = `${parent.clientHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      animationFrameId = null;
      const { zoom, panX, panY } = useCanvasStore.getState();
      prune(LASER_FADE_MS);
      const currentPoints = points.current;

      const dpr = window.devicePixelRatio || 1;
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
      if (currentPoints.length > 0) {
        const now = Date.now();
        ctx.save();
        ctx.lineWidth = 5.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(255, 94, 0, 0.95)';
        ctx.shadowColor = 'rgba(255, 94, 0, 0.65)';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        currentPoints.forEach((point, index) => {
          const screenX = point.x * zoom + panX;
          const screenY = point.y * zoom + panY;
          if (index === 0) ctx.moveTo(screenX, screenY);
          else ctx.lineTo(screenX, screenY);
        });
        const latestPoint = currentPoints[currentPoints.length - 1];
        if (latestPoint) {
          ctx.globalAlpha = Math.max(0, 1 - (now - latestPoint.createdAt) / LASER_FADE_MS);
        }
        ctx.stroke();

        if (isActiveRef.current && latestPoint) {
          const screenX = latestPoint.x * zoom + panX;
          const screenY = latestPoint.y * zoom + panY;
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.arc(screenX, screenY, 6, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 94, 0, 0.95)';
          ctx.shadowBlur = 8;
          ctx.fill();
        }
        ctx.restore();
      }

      if (isActiveRef.current || points.current.length > 0) {
        animationFrameId = requestAnimationFrame(draw);
      }
    };

    const scheduleDraw = () => {
      if (animationFrameId === null) animationFrameId = requestAnimationFrame(draw);
    };

    resizeCanvas();
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      resizeObserver = new ResizeObserver(() => {
        resizeCanvas();
        scheduleDraw();
      });
      resizeObserver.observe(canvas.parentElement);
    }

    const handleLaserEvent = () => scheduleDraw();
    window.addEventListener('dripl:laser-start', handleLaserEvent);
    window.addEventListener('dripl:laser-move', handleLaserEvent);
    window.addEventListener('dripl:laser-end', handleLaserEvent);
    scheduleDraw();

    return () => {
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
      resizeObserver?.disconnect();
      window.removeEventListener('dripl:laser-start', handleLaserEvent);
      window.removeEventListener('dripl:laser-move', handleLaserEvent);
      window.removeEventListener('dripl:laser-end', handleLaserEvent);
    };
  }, [points, prune]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 z-30 pointer-events-none overflow-visible"
      aria-hidden="true"
    />
  );
}
