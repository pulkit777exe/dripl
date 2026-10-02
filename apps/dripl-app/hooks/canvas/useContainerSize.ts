'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Canvas container sizing via ResizeObserver.
 *
 * Extracted verbatim from RoughCanvas: owns the container ref, the ready
 * flag, and the measured size. The callback ref assigns the element and
 * flips readiness; the effect observes and unobserves on unmount.
 */
export function useContainerSize() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerReady, setContainerReady] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const setContainerRef = useCallback((el: HTMLDivElement | null) => {
    (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    setContainerReady(!!el);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(entries => {
      if (!entries || entries.length === 0) return;
      const entry = entries[0];
      if (!entry) return;
      const rect = entry.contentRect;
      setContainerSize({
        width: rect.width || container.clientWidth,
        height: rect.height || container.clientHeight,
      });
    });

    observer.observe(container);

    setContainerSize({
      width: container.clientWidth,
      height: container.clientHeight,
    });

    return () => {
      observer.disconnect();
    };
  }, [containerReady]);

  return { containerRef, containerReady, containerSize, setContainerRef };
}
