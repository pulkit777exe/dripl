'use client';

import { useEffect, useRef } from 'react';
import { useCanvasStore } from '@/lib/store';
import { useLaserTrail } from '@/hooks/canvas/useLaserTrail';

const LASER_FADE_MS = 1000;

export function LaserCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const trail = useLaserTrail();

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
      // Read zoom/pan from store directly to avoid recreating RAF loop
      const { zoom, panX, panY } = useCanvasStore.getState();
      // Prune old points and read the live array
      trail.prune(LASER_FADE_MS);
      const points = trail.points.current;

      // Clear the canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (points.length > 0) {
        const now = Date.now();
        ctx.save();

        // Configure laser trail style
        ctx.lineWidth = 5.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(255, 94, 0, 0.95)';
        ctx.shadowColor = 'rgba(255, 94, 0, 0.65)';
        ctx.shadowBlur = 6;

        ctx.beginPath();
        points.forEach((point, index) => {
          const screenX = point.x * zoom + panX;
          const screenY = point.y * zoom + panY;

          if (index === 0) {
            ctx.moveTo(screenX, screenY);
          } else {
            ctx.lineTo(screenX, screenY);
          }
        });

        // Get overall trail opacity from the latest point
        const latestPoint = points[points.length - 1];
        if (latestPoint) {
          const latestAge = now - latestPoint.createdAt;
          ctx.globalAlpha = Math.max(0, 1 - latestAge / LASER_FADE_MS);
        }

        ctx.stroke();

        // Draw active laser dot at the pointer
        if (trail.isActive) {
          const head = points[points.length - 1];
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
  }, [trail]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 z-30 pointer-events-none overflow-visible"
    />
  );
}
