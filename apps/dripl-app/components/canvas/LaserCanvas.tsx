'use client';

import { useEffect, useRef } from 'react';
import { useCanvasStore } from '@/lib/canvas-store';

interface LaserPoint {
  x: number;
  y: number;
  createdAt: number;
}

const LASER_FADE_MS = 1000;

export function LaserCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointsRef = useRef<LaserPoint[]>([]);
  const isDrawingRef = useRef(false);

  const zoom = useCanvasStore(state => state.zoom);
  const panX = useCanvasStore(state => state.panX);
  const panY = useCanvasStore(state => state.panY);

  useEffect(() => {
    const handleStart = (e: Event) => {
      const custom = e as CustomEvent<{ x: number; y: number }>;
      if (!custom.detail) return;
      isDrawingRef.current = true;
      pointsRef.current = [{ x: custom.detail.x, y: custom.detail.y, createdAt: Date.now() }];
    };

    const handleMove = (e: Event) => {
      const custom = e as CustomEvent<{ x: number; y: number }>;
      if (!custom.detail || !isDrawingRef.current) return;
      const now = Date.now();
      pointsRef.current = [
        ...pointsRef.current.slice(-160),
        { x: custom.detail.x, y: custom.detail.y, createdAt: now },
      ];
    };

    const handleEnd = () => {
      isDrawingRef.current = false;
    };

    window.addEventListener('dripl:laser-start', handleStart);
    window.addEventListener('dripl:laser-move', handleMove);
    window.addEventListener('dripl:laser-end', handleEnd);

    return () => {
      window.removeEventListener('dripl:laser-start', handleStart);
      window.removeEventListener('dripl:laser-move', handleMove);
      window.removeEventListener('dripl:laser-end', handleEnd);
    };
  }, []);

  useEffect(() => {
    let animationFrameId: number;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      if (parent) {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = parent.clientWidth * dpr;
        canvas.height = parent.clientHeight * dpr;
        canvas.style.width = `${parent.clientWidth}px`;
        canvas.style.height = `${parent.clientHeight}px`;
        ctx.scale(dpr, dpr);
      }
    };

    resizeCanvas();
    const resizeObserver = new ResizeObserver(resizeCanvas);
    if (canvas.parentElement) {
      resizeObserver.observe(canvas.parentElement);
    }

    const draw = () => {
      const points = pointsRef.current;
      const now = Date.now();

      // Prune old points
      pointsRef.current = points.filter(p => now - p.createdAt < LASER_FADE_MS);

      // Clear the canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (pointsRef.current.length > 0) {
        ctx.save();

        // Configure laser trail style
        ctx.lineWidth = 5.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(255, 94, 0, 0.95)';
        ctx.shadowColor = 'rgba(255, 94, 0, 0.65)';
        ctx.shadowBlur = 6;

        ctx.beginPath();
        pointsRef.current.forEach((point, index) => {
          const screenX = point.x * zoom + panX;
          const screenY = point.y * zoom + panY;

          // Calculate point opacity based on age
          const age = now - point.createdAt;
          const opacity = Math.max(0, 1 - age / LASER_FADE_MS);

          if (index === 0) {
            ctx.moveTo(screenX, screenY);
          } else {
            ctx.lineTo(screenX, screenY);
          }
        });

        // Get overall trail opacity from the latest point
        const latestPoint = pointsRef.current[pointsRef.current.length - 1];
        if (latestPoint) {
          const latestAge = now - latestPoint.createdAt;
          ctx.globalAlpha = Math.max(0, 1 - latestAge / LASER_FADE_MS);
        }

        ctx.stroke();

        // Draw active laser dot at the pointer
        if (isDrawingRef.current) {
          const head = pointsRef.current[pointsRef.current.length - 1];
          if (head) {
            const screenX = head.x * zoom + panX;
            const screenY = head.y * zoom + panY;
            ctx.globalAlpha = 1.0;
            ctx.beginPath();
            ctx.arc(screenX, screenY, 6, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 94, 0, 0.95)';
            ctx.shadowBlur = 8;
            ctx.fill();
          }
        }

        ctx.restore();
      }

      animationFrameId = requestAnimationFrame(draw);
    };

    animationFrameId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
    };
  }, [zoom, panX, panY]);

  return <canvas ref={canvasRef} className="absolute inset-0 z-30 pointer-events-none overflow-visible" />;
}
