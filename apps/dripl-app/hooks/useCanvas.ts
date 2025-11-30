import { useEffect, useState } from 'react';
import { canvasStore, addElement } from '@dripl/state';
import { createElement } from '@dripl/element';
import { SHAPES, Point, ShapeType, DriplElement } from '@dripl/common';

export const useCanvas = (canvasRef: React.RefObject<HTMLCanvasElement | null>) => {
  const [tool, setTool] = useState(canvasStore.state.tool);
  const [previewElement, setPreviewElement] = useState<DriplElement | null>(null);
  
  // Subscribe to tool changes
  useEffect(() => {
    const unsubscribe = canvasStore.subscribe(() => {
      setTool(canvasStore.state.tool);
    });
    return unsubscribe;
  }, []);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<Point | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const getPoint = (e: MouseEvent): Point => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (tool === 'selection') return;
      
      setIsDrawing(true);
      setStartPoint(getPoint(e));
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDrawing || !startPoint) return;

      const currentPoint = getPoint(e);
      const width = currentPoint.x - startPoint.x;
      const height = currentPoint.y - startPoint.y;

      // Normalize dimensions
      const x = width < 0 ? currentPoint.x : startPoint.x;
      const y = height < 0 ? currentPoint.y : startPoint.y;
      const w = Math.abs(width);
      const h = Math.abs(height);

      if (Object.values(SHAPES).includes(tool as any)) {
        const element = createElement(tool as ShapeType, x, y, w, h);
        setPreviewElement(element);
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!isDrawing || !startPoint) return;

      const endPoint = getPoint(e);
      const width = endPoint.x - startPoint.x;
      const height = endPoint.y - startPoint.y;

      if (Math.abs(width) > 5 || Math.abs(height) > 5) {
        // Normalize dimensions (handle negative width/height)
        const x = width < 0 ? endPoint.x : startPoint.x;
        const y = height < 0 ? endPoint.y : startPoint.y;
        const w = Math.abs(width);
        const h = Math.abs(height);

        // Create element based on tool
        if (Object.values(SHAPES).includes(tool as any)) {
             const element = createElement(tool as ShapeType, x, y, w, h);
             addElement(element);
        }
      }

      setIsDrawing(false);
      setStartPoint(null);
      setPreviewElement(null);
    };

    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
    };
  }, [tool, isDrawing, startPoint, canvasRef]);

  return { previewElement };
};
